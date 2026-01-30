# SyncClient – Minimal standalone usage

This repo includes a WebSocket-based sync client at `public/js/SyncClient.mjs`.

This document shows the **target simplest setup**: a single HTML page with:
- a `<video>` element
- a small **status/toggle button** (ToggleButton is created internally by `SyncClient.mjs`)
- a configurable sync server address (`host:port`)

## 1) Folder layout (minimal)

You need these files available under the same web root:

- `index.html` (the page below)
- `./js/SyncClient.mjs`
- `./js/ToggleButton.js` (imported by SyncClient)
- `./img/link.svg` (or your own SVG)

If you’re using this repository as-is, those already exist under `public/`.

## 2) Minimal HTML page

Create `public/syncclient-minimal.html` (or any file under `public/`) with:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>SyncClient Minimal</title>
</head>
<body style="background:#000;color:#fff;font-family:system-ui, sans-serif; padding:16px;">
  <h1 style="font-size:18px; margin:0 0 12px;">SyncClient Minimal</h1>

  <!-- The local player element SyncClient will control -->
  <video
    id="LocalPlayer"
    src="./video/example.mp4"
    controls
    playsinline
    preload="metadata"
    style="width: min(900px, 100%); display:block; background:#111;"
  ></video>

  <!-- Container where SyncClient will mount the ToggleButton -->
  <div id="syncButton" style="margin-top:12px;"></div>

  <script type="module">
    import { initSyncClient } from './js/SyncClient.mjs';

    // Change this to your server (host:port)
    const syncServer = 'localhost:5001';

    // Create + connect sync client, and mount a toggle/status button.
    // - connected: red
    // - disconnected: white
    // - unavailable: gray
    const client = initSyncClient('LocalPlayer', null, syncServer, {
      container: '#syncButton',
      svgUrl: './img/link.svg',
      size: 40,
      colorConnected: '#cc0000',
      colorDisconnected: '#ffffff',
      colorUnavailable: '#a8b3c7',
    });

    // Optional: expose for debugging
    window.syncClient = client;
  </script>
</body>
</html>
```
