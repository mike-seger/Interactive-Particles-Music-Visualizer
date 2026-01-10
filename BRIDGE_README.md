# Bridge for Polaris Player Integration

This file enables the Interactive Particles Music Visualizer to be used as an embedded component within the Polaris Player.

## What is this?

`bridge.html` is a communication bridge that allows the Polaris Player to control this visualizer application via iframe and postMessage API.

## How it works

When loaded in an iframe by Polaris Player:
- Automatically initializes the visualizer App
- Listens for commands from parent window (play, pause, seek, etc.)
- Sends playback state updates back to parent
- Hides standalone UI elements (controls, header)

## Standalone vs Embedded Mode

### Standalone Mode (Original)
Load `index.html` directly - full standalone experience with controls

### Embedded Mode (Polaris Integration)  
Load `bridge.html` in iframe - controlled by parent player

## Files

- `bridge.html` - Integration bridge (this file)
- `index.html` - Original standalone version (unchanged)
- `src/js/` - Visualizer code (unchanged)

## Communication Protocol

### Messages from Polaris → Visualizer
```javascript
{ type: 'LOAD_TRACK', url: 'path/to/audio.mp3', trackId: '...' }
{ type: 'PLAY' }
{ type: 'PAUSE' }
{ type: 'SEEK', time: 123.45 }
{ type: 'SET_VOLUME', volume: 0.75 }
{ type: 'SET_MUTED', muted: true }
```

### Messages from Visualizer → Polaris
```javascript
{ type: 'VISUALIZER_READY' }
{ type: 'TIME_UPDATE', currentTime: 45.2, duration: 180.0 }
{ type: 'PLAYING' }
{ type: 'PAUSED' }
{ type: 'ENDED' }
{ type: 'ERROR', error: 'error message' }
```

## Usage with Polaris

See `VISUALIZER_INTEGRATION.md` in the Polaris Player repository for complete integration documentation.

Quick start:
```javascript
// In browser console:
__polarisVisualizer.enable()
```

## Development

This file can be modified independently of the main visualizer code. Changes to the postMessage protocol should be coordinated between:
- This file (`bridge.html`)
- Polaris adapter (`public/js/players/adapters/VisualizerAdapter.mjs`)

## Maintaining Independence

The visualizer's core code (`src/js/`) remains completely unchanged. This bridge file is the **only** addition needed for integration, keeping both projects independent and maintainable.
