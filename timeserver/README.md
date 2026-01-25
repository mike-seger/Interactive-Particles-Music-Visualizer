# Time Sync Server

A zero-dependency Node server that exposes a shared clock via SSE and a compact dark admin panel (dat.GUI). Use it to coordinate audio/video/visualizer playback by syncing to the reported time. If the server is unreachable, clients can fall back to starting immediately.

## Running

```
cd timeserver
node server.js
```

Default port is `4000`; override with `PORT=5000 node server.js`.

## Endpoints

- `GET /api/state` — Current clock `{ timeMs, running, offsetMs }`.
- `GET /api/events` — Server-Sent Events stream; messages contain the same payload as `/api/state`.
- `POST /api/control` — `{ action: "start" | "pause" | "reset" | "jump", offsetMs?: number }`.
- `POST /api/save` — Persists the current time to `state.json` (always saved paused).
- `POST /api/load` — Loads `state.json`, applies the saved offset, and keeps the clock paused until you start.

## Admin UI (dark panel)

Open `http://localhost:4000/` to access the panel:
- Play / Pause toggle and Reset to zero.
- Jump to an explicit offset (`hh:mm:ss.mmm`) by clicking the label or finishing edit.
- Live clock readout; reconnects automatically if SSE drops.
- Live clock readout; reconnects automatically if SSE drops.

## Client sketch (with failover)

```js
function connectClock(onTick) {
  let fallbackTimer;
  function startFallback() {
    clearInterval(fallbackTimer);
    const started = performance.now();
    fallbackTimer = setInterval(() => onTick(performance.now() - started), 200);
  }

  try {
    const es = new EventSource('http://localhost:4000/api/events');
    es.onmessage = (ev) => {
      const { timeMs, running } = JSON.parse(ev.data);
      if (running) onTick(timeMs);
    };
    es.onerror = () => {
      es.close();
      startFallback();
    };
  } catch (err) {
    startFallback();
  }
}
```

Hook `onTick(timeMs)` to your player/visualizer: apply small playback rate nudges for sub-150 ms drift and only hard-seek when drift exceeds your chosen threshold.

### Minimal client class

For a drop-in client with auto-reconnect and local fallback, import `AutoSyncClient` from `example-client/public/AutoSyncClient.js`:

```js
import AutoSyncClient from './AutoSyncClient.js';

const sync = new AutoSyncClient({
  serverUrl: 'http://localhost:4000',
  name: 'my-client',
  onStatus: ({ label, ok }) => console.log(label, ok),
});

// Read the current synchronized time (ms)
const t = sync.getTime();

// Jump the server clock (if connected & following)
sync.jump(15_000);

// Temporarily detach and run locally
sync.detach();
```
