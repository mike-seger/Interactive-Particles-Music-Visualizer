// Minimal self-managing client for the time sync server.
// Handles SSE connect/retry, local fallback, and server control helpers.

const clamp = (val, min, max) => Math.min(max, Math.max(min, val));

const STABLE_RATE_STORAGE_KEY = 'mediasync_stable_rate';

const formatTime = (ms) => {
  const totalSec = Math.floor(ms / 1000);
  const millis = Math.floor(ms % 1000);
  const hours = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`;
};

class MediaSyncHandle {
  constructor(mediaEl, options) {
    this._el = mediaEl;
    this._getTimeMs = options.getTimeMs;
    this._shouldPlay = options.shouldPlay;
    this._getTrackLengthMs = options.getTrackLengthMs;
    this._label = options.label || 'media';
    this._loop = !!options.loop;
    this._seekThresholdMs = options.seekThresholdMs ?? 200; // begin corrective rate push when drift exceeds this
    this._rateGain = options.rateGain ?? 0.0001; // rate delta per ms drift
    this._maxRateDelta = options.maxRateDelta ?? 0.15; // +/-15% default headroom for catch-up experiments
    this._stableRateDelta = options.stableRateDelta ?? 0.0003; // consider rate stable within this delta
    this._stableRateWindowMs = options.stableRateWindowMs ?? 10000; // require stability for this window
    this._maxRateStep = options.maxRateStep ?? 0.001; // limit per-iteration rate change to avoid jumps
    this._postCorrectionHoldMs = options.postCorrectionHoldMs ?? 5000; // freeze at stable rate after correction to avoid immediate drift regrowth
    this._logEveryMs = options.logEveryMs ?? 1000;
    this._fallbackDurationMs = options.fallbackDurationMs ?? 60 * 60 * 1000;
    this._driftEmaHalfLifeMs = options.driftEmaHalfLifeMs ?? 1500;
    this._baseRate = Number.isFinite(options.baseRate) ? options.baseRate : (mediaEl?.playbackRate || 1);

    // Initialize all state properties first
    this._raf = null;
    this._lastLog = 0;
    this._startAtMs = performance.now();
    this._lastEmaUpdate = 0;
    this._driftEmaMs = 0;
    this._prevDriftMs = null;
    this._lastRateApplied = null;
    this._rateStableSinceMs = 0;
    this._stableMinRate = null;
    this._stableMaxRate = null;
    this._stableHoldRate = null;

    // Try to restore previously saved stable rate from localStorage
    try {
      const saved = localStorage.getItem(STABLE_RATE_STORAGE_KEY);
      if (saved) {
        const savedRate = parseFloat(saved);
        if (Number.isFinite(savedRate) && savedRate > 0.5 && savedRate < 2.0) {
          this._stableHoldRate = savedRate;
          // Initialize drift EMA to match restored rate so it doesn't reconverge from baseRate
          this._driftEmaMs = -(savedRate - this._baseRate) / this._rateGain;
          // Mark as already applied so adaptive control doesn't recalculate on first sync
          this._lastRateApplied = savedRate;
          // Lock as stable immediately since we restored a previously stable rate
          this._stableLocked = true;
          this._rateStableSinceMs = this._startAtMs;
          this._log(`restored stable rate from storage: ${savedRate.toFixed(4)}, driftEma=${this._driftEmaMs.toFixed(1)}ms, locked`);
          // Set initial playback rate if media element exists
          if (this._el) {
            this._el.playbackRate = savedRate;
          }
        }
      }
    } catch (err) {
      // localStorage might not be available
    }
    this._stableLocked = this._stableLocked || false;
    this._correctingDrift = false;
    this._correctionDesiredDelta = null;
    this._correctionTargetRate = null;
    this._correctionBaseRate = null;
    this._correctionSign = 0;
    this._postCorrectionHoldUntilMs = 0;
    this._correctionCount = 0;
    this._lastCorrectionEndMs = 0;
    this._running = true;
    this._onReady = this._handleReady.bind(this);
    this._el?.addEventListener('loadedmetadata', this._onReady);
    this._start();
  }

  dispose() {
    this._running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    if (this._el) this._el.removeEventListener('loadedmetadata', this._onReady);
    if (this._el && Number.isFinite(this._baseRate)) this._el.playbackRate = this._baseRate;
  }

  setOffsetMs(offsetMs, reason = 'external-set') {
    if (!this._el || !Number.isFinite(offsetMs)) return;
    const targetSec = this._mapToTrackSeconds(offsetMs);
    this._log(`seek -> ${targetSec.toFixed(3)}s (${reason}), readyState=${this._el.readyState}`);
    if (this._el.readyState >= 1) {
      this._el.currentTime = targetSec;
    } else {
      // Media not ready; queue seek for when metadata loads.
      const doSeek = () => {
        this._el.removeEventListener('loadedmetadata', doSeek);
        this._el.currentTime = targetSec;
        this._log(`deferred seek -> ${targetSec.toFixed(3)}s`);
      };
      this._el.addEventListener('loadedmetadata', doSeek, { once: true });
    }
  }

  resetForSeek(offsetMs, reason = 'server-seek') {
    // Reset all rate-correction state and perform an immediate seek.
    // Preserve stable rate if we had one - use it as starting point for next convergence.
    const preservedStableRate = this._stableHoldRate;
    
    this._stableLocked = false;
    this._stableMinRate = null;
    this._stableMaxRate = null;
    this._rateStableSinceMs = 0;
    this._correctingDrift = false;
    this._correctionTargetRate = null;
    this._correctionDesiredDelta = null;
    this._correctionBaseRate = null;
    this._correctionSign = 0;
    this._postCorrectionHoldUntilMs = 0;
    this._prevDriftMs = null;
    this._lastRateApplied = null;
    this._correctionCount = 0;
    this._lastCorrectionEndMs = 0;
    
    // If we had a stable rate, start from there instead of baseRate.
    // Initialize drift EMA to match the preserved rate so it doesn't immediately drop back to baseRate.
    if (this._el && preservedStableRate && Number.isFinite(preservedStableRate)) {
      this._el.playbackRate = preservedStableRate;
      this._lastRateApplied = preservedStableRate;
      // Calculate drift EMA that would produce this rate: rateDelta = -driftEmaMs * rateGain
      // nextRate = baseRate + rateDelta, so: preservedRate = baseRate + (-driftEmaMs * rateGain)
      // Therefore: driftEmaMs = -(preservedRate - baseRate) / rateGain
      this._driftEmaMs = -(preservedStableRate - this._baseRate) / this._rateGain;
      // Lock as stable immediately since we're preserving a previously stable rate
      this._stableLocked = true;
      this._rateStableSinceMs = performance.now();
      this._log(`reset: starting from preserved stable rate ${preservedStableRate.toFixed(4)}, driftEma=${this._driftEmaMs.toFixed(1)}ms, locked`);
    } else {
      this._driftEmaMs = 0;
      if (this._el && Number.isFinite(this._baseRate)) {
        this._el.playbackRate = this._baseRate;
      }
    }
    
    this.setOffsetMs(offsetMs, reason);
  }

  _handleReady() {
    // Metadata loaded; nothing else needed here but keeps duration fresh.
  }

  _start() {
    const tick = () => {
      if (!this._running) return;
      this._syncOnce();
      this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  }

  _mapToTrackSeconds(timeMs) {
    const lengthMs = this._getTrackLengthMs?.() || this._fallbackDurationMs;
    if (this._loop && Number.isFinite(lengthMs) && lengthMs > 0) {
      const mod = timeMs % lengthMs;
      const wrapped = mod < 0 ? mod + lengthMs : mod;
      return wrapped / 1000;
    }
    const clampedMs = Number.isFinite(lengthMs) ? clamp(timeMs, 0, lengthMs) : Math.max(0, timeMs);
    return clampedMs / 1000;
  }

  _syncOnce() {
    if (!this._el || typeof this._getTimeMs !== 'function') return;
    const now = performance.now();
    const targetMs = this._getTimeMs(now);
    if (!Number.isFinite(targetMs)) return;

    const targetSec = this._mapToTrackSeconds(targetMs);
    const currentSec = this._el.currentTime || 0;
    const driftMs = (currentSec - targetSec) * 1000;

    // If in post-correction hold, keep the stable rate; only abandon early if drift blows up.
    if (this._postCorrectionHoldUntilMs && now < this._postCorrectionHoldUntilMs) {
      const holdRate = this._stableHoldRate ?? this._baseRate;
      this._el.playbackRate = holdRate;
      this._lastRateApplied = holdRate;
      this._prevDriftMs = driftMs;
      if (now - this._lastLog > this._logEveryMs) {
        this._log(`t=${formatTime(targetMs)} drift=${driftMs.toFixed(1)}ms rate=${holdRate.toFixed(4)} hold`);
        this._lastLog = now;
      }
      // If drift grows too large during hold, abort early.
      if (Math.abs(driftMs) > this._seekThresholdMs * 2) {
        this._postCorrectionHoldUntilMs = 0;
      }
      return;
    }

    // Once stable rate is locked, keep using it permanently unless drift exceeds threshold.
    // Don't return early - let it flow to correction check below.
    const shouldUseStableRate = this._stableLocked && !this._correctingDrift && Math.abs(driftMs) <= this._seekThresholdMs;

    const wantPlay = this._shouldPlay?.();
    if (wantPlay && this._el.paused) {
      this._el.play().catch(() => {});
    } else if (!wantPlay && !this._el.paused) {
      this._el.pause();
    }

    const isReady = this._el.readyState >= 1; // HAVE_METADATA or better
    if (!isReady || !wantPlay) return;

    const dt = this._lastEmaUpdate ? (now - this._lastEmaUpdate) : 0;
    const halfLife = Math.max(1, this._driftEmaHalfLifeMs);
    const alpha = dt > 0 ? 1 - Math.exp(-Math.LN2 * dt / halfLife) : 1;
    this._driftEmaMs = (1 - alpha) * this._driftEmaMs + alpha * driftMs;
    this._lastEmaUpdate = now;

    const rateDelta = clamp(-this._driftEmaMs * this._rateGain, -this._maxRateDelta, this._maxRateDelta);
    const nextRate = clamp(this._baseRate + rateDelta, this._baseRate - this._maxRateDelta, this._baseRate + this._maxRateDelta);

    // If already in a correction phase, hold the locked target rate and only watch for sign flip or near-zero.
    if (this._correctingDrift) {
      const driftSign = Math.sign(driftMs);
      const driftFlipped = this._correctionSign !== 0 && driftSign !== 0 && driftSign !== this._correctionSign;
      const driftSmall = Math.abs(driftMs) <= this._seekThresholdMs * 0.1; // close to zero
      if (driftFlipped || driftSmall) {
        // Drift crossed zero or is close enough; restore stable rate and enter hold.
        this._lastCorrectionEndMs = now;
        
        // If we've had 3+ corrections in rapid succession, the stable rate is wrong.
        let holdRate = this._stableHoldRate ?? this._baseRate;
        if (this._correctionCount >= 3) {
          holdRate = this._baseRate;
          this._stableHoldRate = this._baseRate;
          this._correctionCount = 0;
          this._log(`oscillation detected (early exit), updated stable rate to baseRate: ${this._baseRate.toFixed(4)}`);
          try {
            localStorage.setItem(STABLE_RATE_STORAGE_KEY, this._baseRate.toString());
          } catch (err) {}
        }
        
        this._correctingDrift = false;
        this._correctionDesiredDelta = null;
        this._correctionTargetRate = null;
        this._correctionBaseRate = null;
        this._correctionSign = 0;
        this._el.playbackRate = holdRate;
        this._lastRateApplied = holdRate;
        this._postCorrectionHoldUntilMs = now + this._postCorrectionHoldMs;
        this._driftEmaMs = 0;
        this._lastEmaUpdate = now;
        this._prevDriftMs = driftMs;
        if (now - this._lastLog > this._logEveryMs) {
          const stableForMs = this._rateStableSinceMs ? now - this._rateStableSinceMs : 0;
          this._log(`t=${formatTime(targetMs)} drift=${driftMs.toFixed(1)}ms rate=${holdRate.toFixed(4)} stableFor=${stableForMs.toFixed(0)}ms hold`);
          this._lastLog = now;
        }
        return; // CRITICAL: return to prevent adaptive rate from running
      } else {
        const targetRate = this._correctionTargetRate ?? this._stableHoldRate ?? this._baseRate;
        this._el.playbackRate = targetRate;
        this._lastRateApplied = targetRate;
        this._prevDriftMs = driftMs;
        if (now - this._lastLog > this._logEveryMs) {
          const stableForMs = this._rateStableSinceMs ? now - this._rateStableSinceMs : 0;
          this._log(`t=${formatTime(targetMs)} drift=${driftMs.toFixed(1)}ms rate=${targetRate.toFixed(4)} stableFor=${stableForMs.toFixed(0)}ms corr desiredDelta=${(this._correctionDesiredDelta ?? 0).toFixed(6)} targetRate=${(this._correctionTargetRate ?? targetRate).toFixed(6)}`);
          this._lastLog = now;
        }
        return;
      }
    }

    const prevRate = this._lastRateApplied ?? this._el.playbackRate ?? this._baseRate;
    const steppedRate = clamp(prevRate + clamp(nextRate - prevRate, -this._maxRateStep, this._maxRateStep), this._baseRate - this._maxRateDelta, this._baseRate + this._maxRateDelta);
    this._el.playbackRate = steppedRate;

    // Track rate stability window and span using applied rate, unless already locked.
    if (!this._stableLocked) {
      if (this._lastRateApplied === null || Math.abs(steppedRate - this._lastRateApplied) > this._stableRateDelta) {
        this._rateStableSinceMs = 0;
        this._stableMinRate = steppedRate;
        this._stableMaxRate = steppedRate;
      } else {
        this._stableMinRate = this._stableMinRate === null ? steppedRate : Math.min(this._stableMinRate, steppedRate);
        this._stableMaxRate = this._stableMaxRate === null ? steppedRate : Math.max(this._stableMaxRate, steppedRate);
        const span = this._stableMaxRate - this._stableMinRate;
        if (span <= this._stableRateDelta) {
          if (this._rateStableSinceMs === 0) this._rateStableSinceMs = now;
        } else {
          this._rateStableSinceMs = 0;
          this._stableMinRate = steppedRate;
          this._stableMaxRate = steppedRate;
        }
      }
    }
    this._lastRateApplied = steppedRate;

    const stableForMs = this._rateStableSinceMs ? now - this._rateStableSinceMs : 0;
    const stableSpan = (this._stableMaxRate !== null && this._stableMinRate !== null) ? (this._stableMaxRate - this._stableMinRate) : 0;
    const stableEnough = this._stableLocked || (stableForMs >= this._stableRateWindowMs && stableSpan <= this._stableRateDelta);

    if (stableEnough && !this._stableLocked) {
      this._stableLocked = true;
      this._stableHoldRate = steppedRate;
      this._rateStableSinceMs = now;
      // Persist stable rate to localStorage for future sessions
      try {
        localStorage.setItem(STABLE_RATE_STORAGE_KEY, steppedRate.toString());
      } catch (err) {
        // localStorage might not be available
      }
    }

    // If stableLocked, use a temporary rate correction to drive drift to zero over 5s; hold the target until drift crosses zero.
    let correctionAppliedRate = null;

    if (this._stableLocked) {
      const driftSign = Math.sign(driftMs);

      if (!this._correctingDrift && Math.abs(driftMs) > this._seekThresholdMs) {
        const driftSec = driftMs / 1000;
        this._correctionDesiredDelta = -driftSec / 5; // rate delta needed to clear current drift in 5s
        // Always use baseRate as the base for correction to avoid compounding drift
        this._correctionBaseRate = this._baseRate;
        this._correctionTargetRate = clamp(this._baseRate + this._correctionDesiredDelta, this._baseRate - this._maxRateDelta, this._baseRate + this._maxRateDelta);
        this._correctionSign = driftSign;
        this._correctingDrift = true;
        
        // Track correction frequency to detect oscillation
        const timeSinceLastCorrection = this._lastCorrectionEndMs ? (now - this._lastCorrectionEndMs) : Infinity;
        if (timeSinceLastCorrection < 15000) { // corrections happening within 15s of each other
          this._correctionCount++;
        } else {
          this._correctionCount = 1; // reset if it's been a while
        }
        this._log(`starting correction #${this._correctionCount} (last correction ${(timeSinceLastCorrection/1000).toFixed(1)}s ago)`);
        
        this._el.playbackRate = this._correctionTargetRate; // jump immediately for faster burn-down
        this._lastRateApplied = this._correctionTargetRate;
        this._driftEmaMs = 0;
        this._lastEmaUpdate = now;
      } else if (this._correctingDrift) {
        const driftFlipped = this._correctionSign !== 0 && driftSign !== 0 && driftSign !== this._correctionSign;
        const driftSmall = Math.abs(driftMs) <= this._seekThresholdMs * 0.1; // close enough to zero (~40ms if threshold 400)
        if (driftFlipped || driftSmall) {
          // Drift crossed zero or is sufficiently close
          this._lastCorrectionEndMs = now;
          
          // If we've had 3+ corrections in rapid succession, the stable rate is wrong.
          // Update it to the baseRate which should be correct.
          let rateToUse = this._stableHoldRate;
          if (this._correctionCount >= 3) {
            rateToUse = this._baseRate;
            this._stableHoldRate = this._baseRate;
            this._correctionCount = 0;
            this._log(`oscillation detected, updated stable rate to baseRate: ${this._baseRate.toFixed(4)}`);
            // Persist updated stable rate
            try {
              localStorage.setItem(STABLE_RATE_STORAGE_KEY, this._baseRate.toString());
            } catch (err) {
              // localStorage might not be available
            }
          }
          
          this._correctingDrift = false;
          this._correctionDesiredDelta = null;
          this._correctionTargetRate = null;
          this._correctionBaseRate = null;
          this._correctionSign = 0;
          this._el.playbackRate = rateToUse;
          this._lastRateApplied = rateToUse;
          this._postCorrectionHoldUntilMs = now + this._postCorrectionHoldMs;
          this._driftEmaMs = 0;
          this._lastEmaUpdate = now;
          this._prevDriftMs = driftMs;
        } else {
          const targetRate = this._correctionTargetRate ?? this._stableHoldRate ?? this._baseRate;
          this._el.playbackRate = targetRate;
          this._lastRateApplied = targetRate;
          correctionAppliedRate = targetRate;
        }
      }
    }

    // If stable rate is locked and drift is small, use stable rate with fine-tuning.
    // When drift persists above 10ms, apply gentle adaptive correction to nudge toward zero.
    if (shouldUseStableRate) {
      const holdRate = this._stableHoldRate ?? this._baseRate;
      
      // Apply fine-tuning if drift is persistently outside ±10ms range
      if (Math.abs(driftMs) > 10) {
        // Use very gentle adaptive correction: small rate gain for fine-tuning
        const fineRateDelta = clamp(-this._driftEmaMs * this._rateGain * 0.5, -0.01, 0.01); // ±1% max for fine-tuning
        const fineTunedRate = clamp(holdRate + fineRateDelta, holdRate - 0.01, holdRate + 0.01);
        this._el.playbackRate = fineTunedRate;
        this._lastRateApplied = fineTunedRate;
      } else {
        // Drift is very small, use exact stable rate
        this._el.playbackRate = holdRate;
        this._lastRateApplied = holdRate;
      }
    }

    this._prevDriftMs = driftMs;

    if (now - this._lastLog > this._logEveryMs) {
      const stableForMs = this._rateStableSinceMs ? now - this._rateStableSinceMs : 0;
      const stableLog = !this._stableLocked && this._rateStableSinceMs ? ` stableFor=${stableForMs.toFixed(0)}ms` : '';
      const corrFlag = this._correctingDrift ? 'corr' : (shouldUseStableRate ? 'stable' : 'nocorr');
      const deltaLog = this._correctionDesiredDelta !== null ? ` desiredDelta=${this._correctionDesiredDelta.toFixed(6)} targetRate=${(this._correctionTargetRate ?? 0).toFixed(6)} appliedRate=${(correctionAppliedRate ?? this._el.playbackRate).toFixed(6)}` : '';
      const holdFlag = this._postCorrectionHoldUntilMs && now < this._postCorrectionHoldUntilMs ? ' hold' : '';
      this._log(`t=${formatTime(targetMs)} drift=${driftMs.toFixed(1)}ms rate=${this._el.playbackRate.toFixed(4)}${stableLog} ${corrFlag}${deltaLog}${holdFlag}`);
      this._lastLog = now;
    }
  }

  _log(msg) {
    console.log(`[${this._label}] ${msg}`);
  }
}

export default class AutoSyncClient {
  constructor(options = {}) {
    const {
      serverUrl = 'http://localhost:4000',
      name = 'client',
      onStatus = () => {},
      onServerState = () => {},
      onTime = null,
      followOnStart = false,
      playLocalOnDetach = false,
    } = options;

    this._serverUrl = serverUrl;
    this._name = name;
    this._onStatus = onStatus;
    this._onServerState = onServerState;
    this._onTime = typeof onTime === 'function' ? onTime : null;

    this._es = null;
    this._following = false;
    this._connected = false;
    this._serverState = { timeMs: 0, running: false, at: performance.now(), serverNowMs: Date.now(), seekSeq: 0 };
    this._localState = { offsetMs: 0, startedAt: performance.now(), playing: false };
    this._lastSeekSeq = 0;

    this._mediaSync = null;
    this._timeRaf = null;

    this._reconnectTimer = null;
    this._backoffMs = 1500;
    this._backoffMax = 10000;

    if (followOnStart) this.attach();
    this._startTimeLoop();
  }

  _startTimeLoop() {
    const tick = () => {
      const now = performance.now();
      const t = this.getTime(now);
      if (this._onTime) {
        try {
          this._onTime(t);
        } catch (err) {
          // ignore callback errors
        }
      }
      this._timeRaf = requestAnimationFrame(tick);
    };
    if (!this._timeRaf) this._timeRaf = requestAnimationFrame(tick);
  }

  _stopTimeLoop() {
    if (this._timeRaf) {
      cancelAnimationFrame(this._timeRaf);
      this._timeRaf = null;
    }
  }

  setServerUrl(url) {
    this._serverUrl = url || this._serverUrl;
    if (this._following) this._reconnectSoon(true);
  }

  setFollowing(enable, { playLocal = false } = {}) {
    if (enable) {
      this.attach();
    } else {
      this.detach(playLocal);
    }
  }

  attach() {
    this._following = true;
    this._backoffMs = 1500;
    this._connect(true);
  }

  detach(playLocal = false) {
    this._following = false;
    this._teardown();
    this._switchToLocal(this.getTime(), playLocal);
    this._reportStatus('detached', false);
  }

  setLocal(offsetMs, playing = true) {
    this._switchToLocal(offsetMs, playing);
  }

  setLocalPlaying(playing) {
    const now = performance.now();
    if (playing && !this._localState.playing) {
      this._localState.startedAt = now;
      this._localState.playing = true;
    } else if (!playing && this._localState.playing) {
      const current = this.getTime(now);
      this._localState.offsetMs = current;
      this._localState.startedAt = now;
      this._localState.playing = false;
    }
  }

  setLocalPosition(offsetMs) {
    this._switchToLocal(offsetMs, this._localState.playing);
  }

  attachMedia(mediaEl, options = {}) {
    if (this._mediaSync) this._mediaSync.dispose();
    if (!mediaEl) {
      this._mediaSync = null;
      return null;
    }
    this._mediaSync = new MediaSyncHandle(mediaEl, {
      getTimeMs: (now) => this.getTime(now),
      shouldPlay: () => (this.isFollowing() ? this.isRemoteRunning() : this.isLocalPlaying()),
      ...options,
    });
    return this._mediaSync;
  }

  detachMedia() {
    if (this._mediaSync) this._mediaSync.dispose();
    this._mediaSync = null;
  }

  async control(action, offsetMs) {
    if (!action) return { ok: false, error: 'Missing action' };
    const url = `${(this._serverUrl || '').replace(/\/$/, '')}/api/control`;
    const body = { action };
    if (typeof offsetMs === 'number') body.offsetMs = offsetMs;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return await res.json();
    } catch (err) {
      return { ok: false, error: err?.message || 'control failed' };
    }
  }

  jump(offsetMs) {
    return this.control('jump', offsetMs);
  }

  getTime(now = performance.now()) {
    if (this._following && this._connected) {
      const base = this._serverState.timeMs;
      const delta = this._serverState.running ? now - this._serverState.at : 0;
      return base + delta;
    }

    const delta = this._localState.playing ? now - this._localState.startedAt : 0;
    return this._localState.offsetMs + delta;
  }

  isConnected() {
    return this._connected;
  }

  isFollowing() {
    return this._following;
  }

  isRemoteRunning() {
    return !!this._serverState.running;
  }

  isLocalPlaying() {
    return !!this._localState.playing;
  }

  _connect(isFresh) {
    this._teardown();

    if (!this._following) return;

    this._reportStatus(isFresh ? 'connecting' : 'reconnecting', false);

    const loc = window.location;
    const host = loc.hostname || 'localhost';
    const port = loc.port || (loc.protocol === 'https:' ? '443' : '80');
    const params = new URLSearchParams({ name: this._name, pageHost: host, pagePort: port });
    const fullUrl = `${(this._serverUrl || '').replace(/\/$/, '')}/api/events?${params.toString()}`;

    try {
      this._es = new EventSource(fullUrl);
      this._es.onmessage = (ev) => this._handleMessage(ev);
      this._es.onerror = () => this._handleError();
    } catch (err) {
      this._handleError();
    }
  }

  _handleMessage(ev) {
    try {
      const data = JSON.parse(ev.data || '{}');
      const now = performance.now();

      if (!this._connected) {
        // First successful message: align local to server and sync seekSeq.
        this._switchToLocal(data.timeMs || 0, !!data.running, now);
        this._lastSeekSeq = data.seekSeq || 0;
        // Immediately sync media to server position
        if (this._mediaSync) {
          this._mediaSync.resetForSeek(data.timeMs || 0, 'initial-sync');
        }
      }

      // Detect server-side seek (jump action) by seekSeq change.
      const incomingSeekSeq = data.seekSeq || 0;
      const serverJumped = this._connected && incomingSeekSeq !== this._lastSeekSeq;

      this._serverState = {
        timeMs: data.timeMs || 0,
        running: !!data.running,
        at: now,
        serverNowMs: data.serverNowMs || Date.now(),
        seekSeq: incomingSeekSeq,
      };
      this._lastSeekSeq = incomingSeekSeq;

      // If server jumped, force MediaSyncHandle to seek immediately.
      if (serverJumped) {
        if (this._mediaSync) {
          this._mediaSync.resetForSeek(data.timeMs || 0, 'server-jump');
        }
      }

      this._connected = true;
      this._backoffMs = 1500;
      this._reportStatus('connected', true);
      this._onServerState({ ...this._serverState });
    } catch (err) {
      // ignore parse errors
    }
  }

  _handleError() {
    if (this._connected) {
      const fallbackStart = this.getTime();
      this._switchToLocal(fallbackStart, true);
    }
    this._connected = false;
    this._reportStatus('disconnected', false);
    this._reconnectSoon();
  }

  _switchToLocal(offsetMs = 0, playing = true, now = performance.now()) {
    this._localState.offsetMs = Math.max(0, offsetMs);
    this._localState.startedAt = now;
    this._localState.playing = !!playing;
  }

  _teardown() {
    if (this._es) {
      try {
        this._es.close();
      } catch (err) {
        // ignore
      }
      this._es = null;
    }
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }

  _reconnectSoon(forceImmediate = false) {
    if (!this._following) return;
    if (this._reconnectTimer) return;
    const delay = forceImmediate ? 0 : this._backoffMs;
    this._backoffMs = Math.min(this._backoffMax, Math.round(this._backoffMs * 1.6));
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._connect(false);
    }, delay);
  }

  _reportStatus(label, ok) {
    try {
      this._onStatus({ label, ok, connected: this._connected, following: this._following });
    } catch (err) {
      // ignore callback errors
    }
  }
}
