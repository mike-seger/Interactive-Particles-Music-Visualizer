# Dual-Iframe Integration Guide

## Overview

The visualizer supports a **dual-iframe architecture** that splits the application into two separate iframes:

1. **Canvas iframe** — Renders the visualization without GUI controls
2. **GUI iframe** — Shows only the lil-gui controls with transparent background

This architecture solves the **z-index stacking context problem** where lil-gui controls inside a single iframe cannot appear above player controls in the parent window, no matter how high their z-index is set.

## Architecture

```
┌─────────────────────────────────────────┐
│ Parent Window (polaris-player-2)       │
│                                         │
│  ┌──────────────────────────────────┐  │
│  │ Canvas iframe (z-index: 1)       │  │
│  │ - Full visualization rendering   │  │
│  │ - pointer-events: none           │  │
│  │ - No GUI controls visible        │  │
│  └──────────────────────────────────┘  │
│                                         │
│  ┌──────────────────────────────────┐  │
│  │ Player Controls (z: 1-1000)      │  │
│  │ - Play/pause, volume, etc.       │  │
│  └──────────────────────────────────┘  │
│                                         │
│  ┌──────────────────────────────────┐  │
│  │ GUI iframe (z-index: 1001)       │  │
│  │ - Only lil-gui controls          │  │
│  │ - Transparent background         │  │
│  │ - Interactive (pointer-events)   │  │
│  └──────────────────────────────────┘  │
│                                         │
│  [BroadcastChannel: 'visualizer-sync'] │
│  ↕️ State synchronization between iframes
└─────────────────────────────────────────┘
```

## URL Parameters

The visualizer detects which mode to run in via the `?mode=` URL parameter:

- **`?mode=full`** (default) — Normal standalone mode with both canvas and GUI
- **`?mode=canvas`** — Canvas-only mode for background visualization iframe
- **`?mode=gui`** — GUI-only mode for controls overlay iframe

**Auto-configuration:** The visualizer automatically handles everything based on the URL parameter:
- ✅ Hides "Click to Start" in canvas/gui modes
- ✅ Auto-initializes without user interaction
- ✅ Hides/shows appropriate UI elements
- ✅ Sets up state synchronization between iframes
- ⚠️ **No additional configuration needed** — just use the correct URL parameter

## Integration Steps

### 1. Create Canvas Iframe

```html
<iframe
  id="visualizer-canvas"
  src="https://your-visualizer-url/?mode=canvas"
  style="
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    border: none;
    z-index: 1;
    pointer-events: none;
  "
></iframe>
```

**Key points:**
- `?mode=canvas` — Hides GUI, shows only visualization, **auto-starts without click**
- `pointer-events: none` — Prevents blocking clicks to player controls
- `z-index: 1` — Behind player controls
- Note: `?autostart=1` is not needed; canvas mode automatically bypasses user interaction

### 2. Create GUI Iframe

```html
<iframe
  id="visualizer-gui"
  src="https://your-visualizer-url/?mode=gui"
  style="
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    border: none;
    z-index: 1001;
    background: transparent;
    pointer-events: auto;
  "
></iframe>
```

**Key points:**
- `?mode=gui` — Hides canvas, shows only lil-gui controls, **auto-starts without click**
- `background: transparent` — Allows canvas iframe to show through
- `pointer-events: auto` — GUI controls remain interactive
- `z-index: 1001` — Above player controls (1-1000)
- Note: `?autostart=1` is not needed; GUI mode automatically bypasses user interaction

### 3. Layer Your Player Controls

Your player controls should use z-index values between 1 and 1000:

```css
.player-controls {
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 100; /* or any value 1-1000 */
}
```

### 4. Audio Bridge (Same as Portal Mode)

Both iframes need to receive audio data. Send `AUDIO_DATA` messages to **both** iframes:

```javascript
const canvasIframe = document.getElementById('visualizer-canvas');
const guiIframe = document.getElementById('visualizer-gui');

function sendAudioData(audioData) {
  const message = {
    type: 'AUDIO_DATA',
    frequencyData: Array.from(audioData.frequencyData),
    timeDomainData: Array.from(audioData.timeDomainData)
  };
  
  canvasIframe.contentWindow.postMessage(message, '*');
  guiIframe.contentWindow.postMessage(message, '*');
}

// Example: Send audio data at 60fps
setInterval(() => {
  const audioData = getAudioAnalysisData(); // Your audio analysis
  sendAudioData(audioData);
}, 1000 / 60);
```

## State Synchronization

The two iframes automatically stay in sync using **BroadcastChannel API** (same-origin) or **localStorage events** (cross-origin fallback).

### How It Works

1. User changes visualizer in GUI iframe dropdown
2. GUI iframe sends `SWITCH_VISUALIZER` message via BroadcastChannel
3. Canvas iframe receives message and switches visualizer
4. Both iframes show the same visualizer

### Message Format

```javascript
{
  type: 'SWITCH_VISUALIZER',
  visualizerName: 'Shader: Firestorm Cube'
}
```

**No action required** — synchronization is automatic within the visualizer code.

## Additional URL Parameters

You can combine `?mode=` with other visualizer parameters:

```
?mode=canvas&autostart=1&hideui=1&visualizer=Shader:%20Firestorm%20Cube
```

**Available parameters:**
- `visualizer=<name>` — Start with specific visualizer (e.g., `Reactive Particles`, `Shader: Firestorm Cube`, `M: Flexi - mindblob [flexi]`)
- `autostart=1` — Skip click-to-start in full mode (not needed for canvas/gui modes)
- `hideui=1` — Hide UI elements in full mode (redundant in canvas/gui modes)

## Migration from Portal Mode

If you're currently using the portal integration (`VISUALIZER_PORTAL_INTEGRATION.md`), here are the key differences:

### Portal Mode (Old)
- ❌ Single iframe with z-index stacking issues
- ❌ Complex HTML serialization and portal message protocol
- ❌ GUI controls can't escape iframe stacking context
- ✅ Simpler iframe setup

### Dual-Iframe Mode (New)
- ✅ GUI controls properly layered above player controls
- ✅ Simple BroadcastChannel state sync (no portal messages)
- ✅ Canvas with `pointer-events: none` doesn't block interactions
- ⚠️ Requires two iframes instead of one

### Migration Steps

1. Replace single iframe with two iframes (canvas + GUI)
2. Remove portal message handlers (`PORTAL_CLICK`, `PORTAL_CONTROL_UPDATE`)
3. Keep audio bridge (`AUDIO_DATA` messages) — send to both iframes
4. Adjust z-index layers: canvas (1), player (1-1000), GUI (1001)

## Testing Dual-Iframe Mode

### Local Testing (Same Window)

Open these URLs in separate browser windows/tabs to see each mode:

```
http://localhost:5173/?mode=full     # Normal standalone mode
http://localhost:5173/?mode=canvas   # Canvas-only (no GUI)
http://localhost:5173/?mode=gui      # GUI-only (transparent)
```

### Integration Testing

1. Create a simple HTML file with both iframes (see integration steps above)
2. Open in browser and verify:
   - Canvas iframe shows visualization
   - GUI iframe shows controls overlay
   - Player controls are clickable between the two layers
   - Changing visualizer in GUI updates canvas

### Troubleshooting

**"Click to Start" still visible in iframe:**
- Verify the iframe URL includes `?mode=canvas` or `?mode=gui` parameter
- Check that the visualizer is running the latest build (contains inline mode detection)
- The element should hide automatically - no player-side changes needed
- If using a cached version, do a hard refresh (Cmd+Shift+R / Ctrl+Shift+F5)

**GUI controls not visible:**
- Check GUI iframe z-index is 1001+
- Verify canvas iframe z-index is lower than player controls
- Check GUI iframe `pointer-events: auto`

**Canvas visualization blocked by GUI:**
- GUI iframe must have `background: transparent`
- GUI mode only shows lil-gui controls, canvas is hidden

**Iframes not syncing:**
- Check browser console for "[Channel Sync]" messages
- Both iframes must be same-origin for BroadcastChannel
- Cross-origin falls back to localStorage (slower but works)

**Player controls blocked:**
- Canvas iframe must have `pointer-events: none`
- Canvas iframe z-index must be below player controls

## Browser Compatibility

- **BroadcastChannel API**: Chrome 54+, Firefox 38+, Edge 79+, Safari 15.4+
- **localStorage fallback**: Works in all browsers
- **Transparent background**: Supported in all modern browsers

## Performance Considerations

- **Two iframes**: ~2x memory overhead (one for canvas, one for GUI)
- **State sync**: Minimal overhead (only sends messages on user interaction)
- **Rendering**: Only canvas iframe renders Three.js/WebGL, GUI iframe is lightweight
- **Audio bridge**: Send the same data to both iframes (no processing duplication)

## Example: Complete Integration

```html
<!DOCTYPE html>
<html>
<head>
  <title>Music Player with Visualizer</title>
  <style>
    body {
      margin: 0;
      overflow: hidden;
      font-family: Arial, sans-serif;
    }
    
    /* Canvas iframe (background, z: 1) */
    #visualizer-canvas {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      border: none;
      z-index: 1;
      pointer-events: none;
    }
    
    /* Player controls (z: 100) */
    #player-controls {
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 100;
      background: rgba(0, 0, 0, 0.8);
      padding: 20px;
      border-radius: 10px;
      color: white;
    }
    
    /* GUI iframe (overlay, z: 1001) */
    #visualizer-gui {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      border: none;
      z-index: 1001;
      background: transparent;
      pointer-events: auto;
    }
  </style>
</head>
<body>
  <!-- Canvas visualization (background) -->
  <iframe
    id="visualizer-canvas"
    src="http://localhost:5173/?mode=canvas"
  ></iframe>
  
  <!-- Player controls (middle layer) -->
  <div id="player-controls">
    <button onclick="togglePlay()">Play/Pause</button>
    <input type="range" min="0" max="100" value="50" oninput="setVolume(this.value)">
  </div>
  
  <!-- GUI controls (top layer) -->
  <iframe
    id="visualizer-gui"
    src="http://localhost:5173/?mode=gui"
  ></iframe>
  
  <script>
    const canvasIframe = document.getElementById('visualizer-canvas');
    const guiIframe = document.getElementById('visualizer-gui');
    
    // Example audio data simulation (replace with real audio analysis)
    function sendAudioData() {
      const message = {
        type: 'AUDIO_DATA',
        frequencyData: new Array(128).fill(0).map(() => Math.random() * 255),
        timeDomainData: new Array(128).fill(0).map(() => Math.random() * 255)
      };
      
      try {
        canvasIframe.contentWindow.postMessage(message, '*');
        guiIframe.contentWindow.postMessage(message, '*');
      } catch (e) {
        console.warn('Failed to send audio data:', e);
      }
    }
    
    // Send audio data at 60fps
    setInterval(sendAudioData, 1000 / 60);
    
    function togglePlay() {
      console.log('Toggle playback');
      // Your play/pause logic here
    }
    
    function setVolume(value) {
      console.log('Set volume:', value);
      // Your volume control logic here
    }
  </script>
</body>
</html>
```

## Summary

The dual-iframe architecture provides a clean solution to the z-index stacking problem:

1. ✅ GUI controls properly escape iframe boundaries
2. ✅ Player controls remain fully interactive
3. ✅ Automatic state synchronization between iframes
4. ✅ Same audio bridge pattern as portal mode
5. ✅ No complex HTML serialization or portal protocols

The only tradeoff is managing two iframes instead of one, but the benefits far outweigh this minor complexity.
