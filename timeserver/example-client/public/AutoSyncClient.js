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
    this._seekThresholdMs = options.seekThresholdMs ?? 1500; // seek when >1.5s off
    this._rateGain = options.rateGain ?? 0.0001; // rate delta per ms drift
    this._maxRateDelta = options.maxRateDelta ?? 0.02; // +/-2%
    this._logEveryMs = options.logEveryMs ?? 1000;
    this._fallbackDurationMs = options.fallbackDurationMs ?? 60 * 60 * 1000;
    this._baseRate = Number.isFinite(options.baseRate) ? options.baseRate : (mediaEl?.playbackRate || 1);

    this._raf = null;
    this._lastLog = 0;
    this._lastSeek = 0;
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

    if (Math.abs(driftMs) > this._seekThresholdMs) {
      this._log(`seek -> ${targetSec.toFixed(3)}s (drift ${driftMs.toFixed(1)}ms)`);
      this._el.currentTime = targetSec;
      this._el.playbackRate = this._baseRate;
      this._lastSeek = now;
    } else {
      const rateDelta = clamp(-driftMs * this._rateGain, -this._maxRateDelta, this._maxRateDelta);
      const nextRate = this._baseRate + rateDelta;
      this._el.playbackRate = clamp(nextRate, this._baseRate - this._maxRateDelta, this._baseRate + this._maxRateDelta);
    }

    if (now - this._lastLog > this._logEveryMs) {
      this._log(`drift=${driftMs.toFixed(1)}ms rate=${this._el.playbackRate.toFixed(4)}`);
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
    } = options;

    this._serverUrl = serverUrl;
    this._name = name;
    this._onStatus = onStatus;
    this._onServerState = onServerState;

    this._es = null;
    this._following = true;
    this._connected = false;
    this._serverState = { timeMs: 0, running: false, at: performance.now(), serverNowMs: Date.now() };
    this._localState = { offsetMs: 0, startedAt: performance.now(), playing: false };

    this._mediaSync = null;

    this._reconnectTimer = null;
    this._backoffMs = 1500;
    this._backoffMax = 10000;

    this.attach();
  }

  setServerUrl(url) {
    this._serverUrl = url || this._serverUrl;
    if (this._following) this._reconnectSoon(true);
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
