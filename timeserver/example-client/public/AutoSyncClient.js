// Minimal self-managing client for the time sync server.
// Handles SSE connect/retry, local fallback, and server control helpers.

const clamp = (val, min, max) => Math.min(max, Math.max(min, val));

class MediaSyncHandle {
  constructor(mediaEl, options) {
    this._el = mediaEl;
    this._getTimeMs = options.getTimeMs;
    this._shouldPlay = options.shouldPlay;
    this._getTrackLengthMs = options.getTrackLengthMs;
    this._label = options.label || 'media';
    this._loop = !!options.loop;
    this._seekThresholdMs = options.seekThresholdMs ?? 400; // seek when >0.4s off
    this._rateGain = options.rateGain ?? 0.0001; // rate delta per ms drift
    this._maxRateDelta = options.maxRateDelta ?? 0.15; // +/-15% default headroom for catch-up experiments
    this._stableRateDelta = options.stableRateDelta ?? 0.0003; // consider rate stable within this delta
    this._stableRateWindowMs = options.stableRateWindowMs ?? 10000; // require stability for this window
    this._stableSeekCooldownMs = options.stableSeekCooldownMs ?? 20000; // minimum gap between stability seeks
    this._postStableFreezeMs = options.postStableFreezeMs ?? 20000; // hold rate fixed and throttle seeks while frozen
    this._maxRateStep = options.maxRateStep ?? 0.001; // limit per-iteration rate change to avoid jumps
    this._freezeForever = options.freezeForever ?? true; // once frozen, stay frozen (no adaptive rate updates)
    this._driftTightThresholdMs = options.driftTightThresholdMs ?? 90; // target drift window while frozen
    this._seekOvershootRatio = options.seekOvershootRatio ?? 0.15; // apply 15% overshoot when seeking to correct drift
    this._logEveryMs = options.logEveryMs ?? 1000;
    this._fallbackDurationMs = options.fallbackDurationMs ?? 60 * 60 * 1000;
    this._seekCooldownMs = options.seekCooldownMs ?? 2000; // minimum gap between seeks
    this._driftEmaHalfLifeMs = options.driftEmaHalfLifeMs ?? 1500;
    this._worseningMarginMs = options.worseningMarginMs ?? 50; // require drift to get worse by this margin before seek
    this._baseRate = Number.isFinite(options.baseRate) ? options.baseRate : (mediaEl?.playbackRate || 1);

    this._raf = null;
    this._lastLog = 0;
    this._lastSeek = 0;
    this._lastStableSeek = 0;
    this._startAtMs = performance.now();
    this._lastEmaUpdate = 0;
    this._driftEmaMs = 0;
    this._prevDriftMs = null;
    this._lastRateApplied = null;
    this._rateStableSinceMs = 0;
    this._stableMinRate = null;
    this._stableMaxRate = null;
    this._frozenRate = null;
    this._frozenUntilMs = 0;
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
    this._log(`seek -> ${targetSec.toFixed(3)}s (${reason})`);
    this._el.currentTime = targetSec;
    this._lastSeek = performance.now();
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

  _seekTargetWithOvershoot(baseTargetSec, driftMs) {
    const baseTargetMs = baseTargetSec * 1000;
    const overshootMs = baseTargetMs - driftMs * this._seekOvershootRatio;
    return this._mapToTrackSeconds(overshootMs);
  }

  _syncOnce() {
    if (!this._el || typeof this._getTimeMs !== 'function') return;
    const now = performance.now();
    const targetMs = this._getTimeMs(now);
    if (!Number.isFinite(targetMs)) return;

    const targetSec = this._mapToTrackSeconds(targetMs);
    const currentSec = this._el.currentTime || 0;
    const driftMs = (currentSec - targetSec) * 1000;

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
    const candidateRate = nextRate;

    // If frozen after a stability seek, hold playbackRate steady forever; only seek when drift exceeds tight threshold and cooldown has passed.
    if (this._frozenRate !== null) {
      this._el.playbackRate = this._frozenRate;
      const sinceLastSeek = now - this._lastSeek;
      if (Math.abs(driftMs) > this._driftTightThresholdMs && sinceLastSeek > this._postStableFreezeMs) {
        const seekSec = this._seekTargetWithOvershoot(targetSec, driftMs);
        this._log(`seek(frozen) -> ${seekSec.toFixed(3)}s (drift ${driftMs.toFixed(1)}ms rate ${this._frozenRate.toFixed(4)})`);
        this._el.currentTime = seekSec;
        this._lastSeek = now;
        this._driftEmaMs = 0;
        this._lastEmaUpdate = now;
      }
      this._prevDriftMs = driftMs;
      if (now - this._lastLog > this._logEveryMs) {
        const elapsedMs = now - (this._startAtMs || now);
        this._log(`t=${elapsedMs.toFixed(0)}ms drift=${driftMs.toFixed(1)}ms ema=${this._driftEmaMs.toFixed(1)}ms rate=${this._el.playbackRate.toFixed(4)} frozen=true`);
        this._lastLog = now;
      }
      return;
    }

    const atCap = Math.abs(rateDelta) >= this._maxRateDelta * 0.8;
    const worsening = this._prevDriftMs !== null && Math.abs(driftMs) > Math.abs(this._prevDriftMs) + this._worseningMarginMs;

    const prevRate = this._lastRateApplied ?? this._el.playbackRate ?? this._baseRate;
    const steppedRate = clamp(prevRate + clamp(nextRate - prevRate, -this._maxRateStep, this._maxRateStep), this._baseRate - this._maxRateDelta, this._baseRate + this._maxRateDelta);
    this._el.playbackRate = steppedRate;

    // Track rate stability window and span using applied rate.
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
    this._lastRateApplied = steppedRate;

    const stableForMs = this._rateStableSinceMs ? now - this._rateStableSinceMs : 0;
    const stableSpan = (this._stableMaxRate !== null && this._stableMinRate !== null) ? (this._stableMaxRate - this._stableMinRate) : 0;
    const stableEnough = stableForMs >= this._stableRateWindowMs && stableSpan <= this._stableRateDelta;

    // Stability-driven seek: once stability window achieved and drift remains beyond threshold.
    if (stableEnough && Math.abs(driftMs) > this._seekThresholdMs && (now - this._lastStableSeek) > this._stableSeekCooldownMs) {
      const seekSec = this._seekTargetWithOvershoot(targetSec, driftMs);
      this._log(`seek(stable) -> ${seekSec.toFixed(3)}s (drift ${driftMs.toFixed(1)}ms rate ${steppedRate.toFixed(4)} span ${stableSpan.toFixed(6)} stableFor=${stableForMs.toFixed(0)}ms)`);
      this._el.currentTime = seekSec;
      this._el.playbackRate = nextRate;
      this._lastSeek = now;
      this._lastStableSeek = now;
      this._driftEmaMs = 0;
      this._lastEmaUpdate = now;
      this._prevDriftMs = driftMs;
      this._rateStableSinceMs = 0;
      this._stableMinRate = nextRate;
      this._stableMaxRate = nextRate;
      this._frozenRate = steppedRate;
      this._frozenUntilMs = now + this._postStableFreezeMs;
      return;
    }

    if (Math.abs(driftMs) > this._seekThresholdMs) {
      const sinceLastSeek = now - this._lastSeek;
      if (sinceLastSeek > this._seekCooldownMs && (worsening || atCap)) {
        const seekSec = this._seekTargetWithOvershoot(targetSec, driftMs);
        this._log(`seek -> ${seekSec.toFixed(3)}s (drift ${driftMs.toFixed(1)}ms)`);
        this._el.currentTime = seekSec;
        this._el.playbackRate = this._baseRate;
        this._lastSeek = now;
        this._driftEmaMs = 0;
        this._lastEmaUpdate = now;
        this._prevDriftMs = driftMs;
        return;
      }
    }

    this._prevDriftMs = driftMs;

    if (now - this._lastLog > this._logEveryMs) {
      const elapsedMs = now - (this._startAtMs || now);
      const stableForMs = this._rateStableSinceMs ? now - this._rateStableSinceMs : 0;
      const stableSpan = (this._stableMaxRate !== null && this._stableMinRate !== null) ? (this._stableMaxRate - this._stableMinRate) : 0;
      const frozenFlag = this._frozenRate !== null;
      this._log(`t=${elapsedMs.toFixed(0)}ms drift=${driftMs.toFixed(1)}ms ema=${this._driftEmaMs.toFixed(1)}ms rate=${this._el.playbackRate.toFixed(4)} stableFor=${stableForMs.toFixed(0)}ms span=${stableSpan.toFixed(6)} frozen=${frozenFlag}`);
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
    } = options;

    this._serverUrl = serverUrl;
    this._name = name;
    this._onStatus = onStatus;
    this._onServerState = onServerState;
    this._onTime = typeof onTime === 'function' ? onTime : null;

    this._es = null;
    this._following = true;
    this._connected = false;
    this._serverState = { timeMs: 0, running: false, at: performance.now(), serverNowMs: Date.now() };
    this._localState = { offsetMs: 0, startedAt: performance.now(), playing: false };

    this._mediaSync = null;
    this._timeRaf = null;

    this._reconnectTimer = null;
    this._backoffMs = 1500;
    this._backoffMax = 10000;

    this.attach();
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

  setFollowing(enable) {
    if (enable) {
      this.attach();
    } else {
      this.detach();
    }
  }

  attach() {
    this._following = true;
    this._backoffMs = 1500;
    this._connect(true);
  }

  detach() {
    this._following = false;
    this._teardown();
    this._switchToLocal(this.getTime());
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
        // First successful message: align local to server.
        this._switchToLocal(data.timeMs || 0, !!data.running, now);
      }

      this._serverState = {
        timeMs: data.timeMs || 0,
        running: !!data.running,
        at: now,
        serverNowMs: data.serverNowMs || Date.now(),
      };

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
