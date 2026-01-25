// Admin UI for the time sync server. Minimal, dark, and dependency-free except for dat.GUI.

const clockEl = document.getElementById('clock');
const statusEl = document.getElementById('status');
const toastEl = document.getElementById('toast');
const guiHost = document.getElementById('gui');

const gui = new lil.GUI({ autoPlace: false, width: 280 });
guiHost.appendChild(gui.domElement);

const model = {
  jumpTo: '00:00:00.000',
};

let lastState = {
  timeMs: 0,
  running: false,
  offsetMs: 0,
  at: performance.now(),
  detached: false,
};

const actions = {
  playPause: () => sendControl(lastState.running ? 'pause' : 'start'),
  reset: () => sendControl('reset'),
  jump: () => {
    const ms = parseTime(model.jumpTo);
    if (ms === null) return notify('Time format should be hh:mm:ss.mmm', true);
    return sendControl('jump', ms);
  },
  detachAttach: () => sendControl(lastState.detached ? 'attach' : 'detach'),
};

gui.add(actions, 'playPause').name('Play / Pause');
gui.add(actions, 'reset').name('Reset to 0');
const jumpController = gui.add(model, 'jumpTo').name('Jump to');
gui.add(actions, 'detachAttach').name('Detach / Attach');

gui.domElement.classList.add('gui-dark');

function formatTime(ms) {
  const safe = Math.max(0, ms);
  const totalMs = Math.floor(safe);
  const milli = totalMs % 1000;
  const totalSeconds = Math.floor(totalMs / 1000);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);

  const pad = (value, size) => value.toString().padStart(size, '0');
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)}.${pad(milli, 3)}`;
}

function parseTime(text) {
  if (!text) return null;
  const trimmed = text.trim();
  // Accept hh:mm:ss.mmm with variable hour length.
  const match = trimmed.match(/^(\d+):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const millis = Number((match[4] || '').padEnd(3, '0'));
  if ([hours, minutes, seconds, millis].some((n) => Number.isNaN(n))) return null;
  if (minutes > 59 || seconds > 59) return null;
  return (((hours * 60 + minutes) * 60 + seconds) * 1000) + millis;
}

function renderLoop() {
  const now = performance.now();
  const base = lastState.running
    ? lastState.timeMs + (now - lastState.at)
    : lastState.timeMs;
  clockEl.textContent = formatTime(base);
  requestAnimationFrame(renderLoop);
}

function applyState(next) {
  lastState = { ...next, at: performance.now() };
  if (next.detached) {
    statusEl.textContent = 'detached';
    statusEl.className = 'tag detached';
  } else {
    statusEl.textContent = next.running ? 'running' : 'paused';
    statusEl.className = next.running ? 'tag running' : 'tag paused';
  }
}

async function fetchState() {
  try {
    const res = await fetch('/api/state', { cache: 'no-store' });
    if (!res.ok) throw new Error('Failed to fetch state');
    const json = await res.json();
    applyState(json);
  } catch (err) {
    notify(err.message || 'Unable to reach server', true);
  }
}

async function apiPost(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
}

async function sendControl(action, offsetMs) {
  try {
    const result = await apiPost('/api/control', { action, offsetMs });
    if (!result.ok) throw new Error(result.error || 'Control failed');
    if (result.state) applyState(result.state);
    if (action === 'jump') {
      const formatted = formatTime(Number(offsetMs || 0));
      model.jumpTo = formatted;
      if (jumpInput) jumpInput.value = formatted;
    }
    notify(action === 'jump' ? 'Jumped' : 'Updated');
  } catch (err) {
    notify(err.message || 'Error', true);
  }
}

function notify(message, isError = false) {
  toastEl.textContent = message;
  toastEl.className = `toast ${isError ? 'error' : 'ok'}`;
  toastEl.style.opacity = '1';
  clearTimeout(notify._t);
  notify._t = setTimeout(() => {
    toastEl.style.opacity = '0';
  }, 1800);
}

function connectSse() {
  const loc = window.location;
  const host = loc.hostname || 'localhost';
  const port = loc.port || (loc.protocol === 'https:' ? '443' : '80');
  const params = new URLSearchParams({ name: 'admin-panel', pageHost: host, pagePort: port });
  const source = new EventSource(`/api/events?${params.toString()}`);
  source.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data);
      applyState(data);
    } catch (err) {
      // Ignore parse errors.
    }
  };
  source.onerror = () => {
    source.close();
    setTimeout(connectSse, 1500);
  };
}

function normalizeIp(raw) {
  if (!raw) return '';
  let ip = raw.trim();
  if (ip.startsWith('[') && ip.endsWith(']')) ip = ip.slice(1, -1);
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (ip.includes('%')) ip = ip.split('%')[0];
  return ip;
}

function formatLocalNoMillis(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

// Trigger jump only on Enter or label click.
const jumpInput = jumpController.domElement.querySelector('input[type="text"]');
if (jumpInput) {
  const rebuildTime = (digits) => {
    const clean = (digits || '').replace(/\D/g, '');
    const padded = clean.padStart(7, '0');
    const hours = padded.slice(0, padded.length - 7) || '0';
    let minutes = Number(padded.slice(-7, -5));
    let seconds = Number(padded.slice(-5, -3));
    let millis = Number(padded.slice(-3));
    minutes = Math.min(Math.max(minutes, 0), 59);
    seconds = Math.min(Math.max(seconds, 0), 59);
    millis = Math.min(Math.max(millis, 0), 999);
    const pad2 = (n) => n.toString().padStart(2, '0');
    const pad3 = (n) => n.toString().padStart(3, '0');
    return `${hours}:${pad2(minutes)}:${pad2(seconds)}.${pad3(millis)}`;
  };

  jumpInput.addEventListener('input', () => {
    const digits = jumpInput.value.replace(/\D/g, '');
    model.jumpTo = rebuildTime(digits);
    jumpInput.value = model.jumpTo;
  });

  jumpInput.addEventListener('keydown', (ev) => {
    const allowedKeys = ['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'Tab', 'Home', 'End'];
    if (ev.key === 'Enter') return actions.jump();
    if (allowedKeys.includes(ev.key)) return;
    if (!/\d/.test(ev.key)) ev.preventDefault();
  });

  jumpInput.value = model.jumpTo;
}

const jumpLabel = jumpController.domElement.querySelector('.name');
if (jumpLabel) {
  jumpLabel.style.cursor = 'pointer';
  jumpLabel.title = 'Click to jump to the entered time';
  jumpLabel.addEventListener('click', () => actions.jump());
}

fetchState();
connectSse();
renderLoop();

// Client list polling
const clientsBody = document.getElementById('clients-body');
const clientsEmpty = document.getElementById('clients-empty');
const clientsTitle = document.querySelector('.clients-title');

async function refreshClients() {
  if (!clientsBody || !clientsEmpty) return;
  try {
    const res = await fetch('/api/clients', { cache: 'no-store' });
    if (!res.ok) throw new Error('Failed to fetch clients');
    const { clients, detached } = await res.json();
    if (clientsTitle) {
      clientsTitle.textContent = detached ? 'Clients (detached)' : 'Clients';
    }
    clientsBody.innerHTML = '';
    if (!clients || !clients.length) {
      clientsEmpty.style.display = 'block';
      return;
    }
    clientsEmpty.style.display = 'none';
    clients
      .slice(0, 50)
      .sort((a, b) => (b.connectedAt || 0) - (a.connectedAt || 0))
      .forEach((c) => {
      const row = document.createElement('tr');
        const ipPort = normalizeIp(c.host || c.ip || '');
        const portVal = c.hostPort ?? c.port ?? '';
        const ts = c.connectedAt ? formatLocalNoMillis(c.connectedAt) : '';
        row.innerHTML = `<td>${ts}</td><td title="${c.name}">${c.name}</td><td>${ipPort}</td><td>${portVal}</td>`;
        clientsBody.appendChild(row);
      });
  } catch (err) {
    // ignore errors; will retry
  }
}

setInterval(refreshClients, 2000);
refreshClients();
