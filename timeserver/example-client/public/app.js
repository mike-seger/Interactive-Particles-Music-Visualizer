import AutoSyncClient from './AutoSyncClient.js';

const connStatusEl = document.getElementById('connStatus');
const serverUrlInput = document.getElementById('serverUrl');
const playPauseBtn = document.getElementById('playPause');
const syncCheckbox = document.getElementById('syncEnabled');
const positionSlider = document.getElementById('position');
const positionValue = document.getElementById('positionValue');
const audioEl = document.getElementById('audio');

const DEFAULT_TRACK_LEN_MS = 60 * 60 * 1000; // fallback until audio metadata loads
const defaultClientName = 'example-client';

let syncClient = null;
let isScrubbing = false;
let trackLengthMs = DEFAULT_TRACK_LEN_MS;
let audioUnlocked = false;
let mediaSync = null;

function unlockAudio() {
  if (!audioEl || audioUnlocked) return;
  audioUnlocked = true;
  // Try a muted play/pause to satisfy autoplay policies.
  audioEl.muted = true;
  audioEl.play().then(() => {
    audioEl.pause();
    audioEl.muted = false;
  }).catch(() => {
    // If this fails, user will need to click Play; avoid spamming logs.
  });
}

function logSeek(reason, targetSec, driftSec = null) {
  const driftMsg = driftSec === null ? '' : ` drift=${(driftSec * 1000).toFixed(1)}ms`;
  console.log(`[audio] seek -> ${targetSec.toFixed(3)}s (${reason})${driftMsg}`);
}

function mapTimeToTrack(ms) {
  if (!Number.isFinite(ms)) return 0;
  if (!Number.isFinite(trackLengthMs) || trackLengthMs <= 0) return Math.max(0, ms);
  // Loop within track length to align with audio element loop.
  const mod = ms % trackLengthMs;
  return mod < 0 ? mod + trackLengthMs : mod;
}

function formatTime(ms) {
  const safe = mapTimeToTrack(ms);
  const milli = Math.floor(safe % 1000);
  const totalSeconds = Math.floor(safe / 1000);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  const pad = (n, len) => n.toString().padStart(len, '0');
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)}.${pad(milli, 3)}`;
}

function setConnStatus(text, ok) {
  connStatusEl.textContent = text;
  connStatusEl.className = `tag ${ok ? 'ok' : 'warn'}`;
}

function handleStatus({ label, ok }) {
  setConnStatus(label, ok);
}

function handleServerState(state) {
  if (isScrubbing || !positionSlider) return;
  // Use predicted time (includes delta since last server tick) to reduce apparent lag.
  const predictedMs = syncClient ? mapTimeToTrack(syncClient.getTime()) : mapTimeToTrack(state.timeMs || 0);
  positionSlider.value = String(Math.floor(predictedMs));
  positionValue.textContent = formatTime(predictedMs);
}

function initClient() {
  if (syncClient) syncClient.detach();
  syncClient = new AutoSyncClient({
    serverUrl: serverUrlInput.value.trim(),
    name: defaultClientName,
    onStatus: handleStatus,
    onServerState: handleServerState,
    onTime: (rawMs) => {
      const current = mapTimeToTrack(rawMs);
      if (!isScrubbing && positionSlider) {
        positionSlider.value = String(Math.floor(current));
        positionValue.textContent = formatTime(current);
      }
    },
  });

  if (audioEl) {
    mediaSync = syncClient.attachMedia(audioEl, {
      label: 'media-sync',
      loop: true,
      fallbackDurationMs: DEFAULT_TRACK_LEN_MS,
      getTrackLengthMs: () => trackLengthMs,
      seekThresholdMs: 400,
      maxRateDelta: 0.15,
      rateGain: 0.0002,
      seekCooldownMs: 5000,
      driftEmaHalfLifeMs: 900,
      worseningMarginMs: 50,
      shouldPlay: () => audioUnlocked && (syncClient.isFollowing() ? syncClient.isRemoteRunning() : syncClient.isLocalPlaying()),
    });
  }
}

function togglePlay() {
  if (syncCheckbox.checked && syncClient?.isConnected()) {
    return; // when synced, follow server
  }
  if (!syncClient) return;
  const currentlyPlaying = syncClient.isLocalPlaying();
  if (currentlyPlaying) {
    syncClient.setLocalPlaying(false);
    playPauseBtn.textContent = 'Play';
    audioEl?.pause();
  } else {
    // Resume from current displayed time.
    syncClient.setLocalPosition(syncClient.getTime());
    syncClient.setLocalPlaying(true);
    playPauseBtn.textContent = 'Pause';
    if (audioEl) {
      const target = mapTimeToTrack(syncClient.getTime());
      logSeek('local-resume', target / 1000);
      mediaSync?.setOffsetMs(target, 'local-resume');
      audioEl.play().catch(() => {});
    }
  }
}

playPauseBtn.addEventListener('click', togglePlay);

syncCheckbox.addEventListener('change', () => {
  const synced = syncCheckbox.checked;
  playPauseBtn.disabled = synced;
  if (!syncClient) return;
  if (!synced) {
    syncClient.setFollowing(false);
    setConnStatus(syncClient.isConnected() ? 'connected' : 'disconnected', syncClient.isConnected());
    // When leaving sync mode, keep audio where it is without forcing corrections.
  } else {
    syncClient.setServerUrl(serverUrlInput.value.trim());
    syncClient.setFollowing(true);
  }
});

serverUrlInput.addEventListener('change', () => {
  if (!syncClient) return;
  syncClient.setServerUrl(serverUrlInput.value.trim());
});

if (positionSlider) {
  positionSlider.addEventListener('input', () => {
    isScrubbing = true;
    const val = Number(positionSlider.value) || 0;
    positionValue.textContent = formatTime(val);
    if (!syncCheckbox.checked || !(syncClient && syncClient.isConnected())) {
      syncClient?.setLocalPosition(val);
      if (audioEl) audioEl.currentTime = mapTimeToTrack(val) / 1000;
    }
  });

  positionSlider.addEventListener('change', () => {
    const val = mapTimeToTrack(Number(positionSlider.value) || 0);
    positionSlider.value = String(val);
    positionValue.textContent = formatTime(val);
    if (syncCheckbox.checked && syncClient?.isConnected()) {
      syncClient.jump(val);
      if (audioEl) {
        logSeek('user-jump-synced', val / 1000);
        mediaSync?.setOffsetMs(val, 'user-jump-synced');
      }
    } else {
      syncClient?.setLocalPosition(val);
      if (audioEl) {
        logSeek('user-jump-local', val / 1000);
        mediaSync?.setOffsetMs(val, 'user-jump-local');
      }
    }
    isScrubbing = false;
  });
}

playPauseBtn.disabled = syncCheckbox.checked;
initClient();
if (positionSlider) {
  positionSlider.max = String(trackLengthMs);
  positionSlider.value = '0';
  positionValue.textContent = '00:00:00.000';
}

if (audioEl) {
  window.addEventListener('pointerdown', unlockAudio, { once: true });
  audioEl.addEventListener('timeupdate', () => {
    console.log(`[audio] timeupdate current=${audioEl.currentTime.toFixed(3)}s paused=${audioEl.paused}`);
  });
  audioEl.addEventListener('loadedmetadata', () => {
    if (Number.isFinite(audioEl.duration)) {
      trackLengthMs = audioEl.duration * 1000;
      if (positionSlider) {
        positionSlider.max = String(trackLengthMs);
      }
      console.log(`[audio] metadata loaded duration=${audioEl.duration.toFixed(3)}s`);
    }
  });

  // Ensure looping so modulo mapping aligns.
  audioEl.loop = true;
  // Start paused until user interacts.
  audioEl.pause();
}
