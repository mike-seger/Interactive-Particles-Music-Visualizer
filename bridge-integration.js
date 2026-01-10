/**
 * Bridge Integration Script for Polaris Player
 * Add this script to the visualizer's index.html to enable auto-start and UI hiding
 * when loaded from the Polaris player bridge.
 * 
 * Usage: Add before the main app script:
 * <script src="./bridge-integration.js"></script>
 */

(function() {
  // Check URL parameters
  const params = new URLSearchParams(window.location.search);
  const autostart = params.get('autostart') === '1';
  const hideui = params.get('hideui') === '1';
  const bridgeMode = autostart || hideui;
  
  console.log('[Visualizer] Bridge integration:', { autostart, hideui, bridgeMode });
  
  // Store reference to external audio element provided by bridge
  window.__bridgeAudioElement = null;
  window.__bridgeAudioContext = null;
  window.__bridgeAnalyser = null;
  
  // Store BPM audio buffer received from bridge
  window.__bridgeBPMBuffer = null;
  
  // Hide UI elements if requested
  if (hideui) {
    const style = document.createElement('style');
    style.textContent = `
      .frame { display: none !important; }
      #player-controls { display: none !important; }
      .user_interaction { display: none !important; }
    `;
    document.head.appendChild(style);
    console.log('[Visualizer] UI elements hidden');
  }
  
  // Auto-start on click requirement
  if (autostart) {
    // Auto-click after a short delay
    setTimeout(() => {
      document.body.click();
      console.log('[Visualizer] Auto-click triggered');
    }, 500);
  }
  
  // Listen for bridge commands via postMessage
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg || typeof msg !== 'object') return;
    
    switch (msg.type) {
      case 'BRIDGE_INIT':
        console.log('[Visualizer] Received bridge init:', msg);
        
        if (msg.hideUI) {
          const style = document.createElement('style');
          style.id = 'bridge-ui-hide';
          style.textContent = `
            .frame { display: none !important; }
            #player-controls { display: none !important; }
            .user_interaction { display: none !important; }
          `;
          if (!document.getElementById('bridge-ui-hide')) {
            document.head.appendChild(style);
          }
        }
        
        if (msg.autoStart) {
          setTimeout(() => {
            document.body.click();
          }, 100);
        }
        break;
        
      case 'AUDIO_DATA':
        // Receive frequency data from bridge and inject into AudioManager
        if (window.App && window.App.audioManager && window.App.audioManager.audioAnalyser) {
          if (msg.frequencyData && window.App.audioManager.audioAnalyser.data) {
            const data = new Uint8Array(msg.frequencyData);
            window.App.audioManager.audioAnalyser.data.set(data);
          }
        }
        break;
        
      case 'BPM_DATA':
        // Receive BPM from bridge (already calculated)
        console.log('[Visualizer] ✓ Received BPM from bridge:', msg.bpm);
        if (window.App && window.App.audioManager) {
          window.App.audioManager.bpm = msg.bpm;
          console.log('[Visualizer] ✓ Set audioManager.bpm to', msg.bpm);
        } else {
          console.log('[Visualizer] ⚠️ App.audioManager not ready yet, BPM will be set later');
        }
        break;
        
      case 'PLAYBACK_STATE':
        // Show/hide particles based on playback state
        if (window.App && window.App.particleManager) {
          if (msg.playing) {
            window.App.particleManager.setActive(true);
          } else {
            window.App.particleManager.setActive(false);
          }
        }
        break;
    }
  });
  
  // In bridge mode, make visualizer completely passive
  if (bridgeMode) {
    console.log('[Visualizer] Setting up passive bridge mode');
    
    // Store original AudioManager for patching
    let AudioManagerPatched = false;
    
    // Intercept at module import level by watching for AudioManager constructor
    const originalCreateElement = document.createElement.bind(document);
    document.createElement = function(tagName) {
      const element = originalCreateElement(tagName);
      
      // Intercept audio element creation
      if (tagName.toLowerCase() === 'audio') {
        console.log('[Visualizer] Audio element created - neutering it');
        // Neuter any audio element created
        element.volume = 0;
        element.muted = true;
        
        // Stub out playback methods
        const noop = () => {};
        const noopPromise = () => Promise.resolve();
        
        element.play = noopPromise;
        element.pause = noop;
        
        // Override load to fake successful loading
        element.load = function() {
          console.log('[Visualizer] Audio load() called - faking success');
          setTimeout(() => {
            this.dispatchEvent(new Event('loadedmetadata'));
            this.dispatchEvent(new Event('loadeddata'));
            this.dispatchEvent(new Event('canplay'));
          }, 10);
        };
        
        // Prevent src from being set and trigger fake load
        Object.defineProperty(element, 'src', {
          get: () => '',
          set: (value) => {
            console.log('[Visualizer] Blocked audio src:', value);
            // Trigger fake loading when src is set
            setTimeout(() => {
              element.dispatchEvent(new Event('loadedmetadata'));
              element.dispatchEvent(new Event('loadeddata'));
              element.dispatchEvent(new Event('canplay'));
            }, 50);
            return '';
          }
        });
        
        // Catch and suppress all errors
        element.addEventListener('error', (e) => {
          console.log('[Visualizer] Suppressed audio error');
          e.stopPropagation();
          e.preventDefault();
          return false;
        }, true);
      }
      
      return element;
    };
    
    // Wait for AudioManager and set it to passive mode
    console.log('[Visualizer] Waiting for AudioManager to set passive mode');
    
    // Wait for App and disable audio loading/BPM detection
    const checkInterval = setInterval(() => {
      if (window.App && window.App.audioManager) {
        clearInterval(checkInterval);
        console.log('[Visualizer] ✓ Found App.audioManager, configuring for bridge mode');
        patchAudioManagerForBridge(window.App.audioManager);
      }
    }, 100);
    
    setTimeout(() => clearInterval(checkInterval), 10000);
  }
  
  function patchAudioManagerForBridge(audioManager) {
    console.log('[Visualizer] Configuring AudioManager for bridge mode (passive)');
    
    // Disable audio loading completely
    audioManager.loadAudioBuffer = async function(onProgress = null) {
      console.log('[Visualizer] loadAudioBuffer called - skipping (bridge mode)');
      
      // Set up minimal analyser for receiving data
      if (!this.audioContext) {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      }
      
      if (!this.audioAnalyser) {
        this.audioAnalyser = {
          data: new Uint8Array(1024),
          getFrequencyData: () => this.audioAnalyser.data
        };
      }
      
      if (onProgress) onProgress(100, true);
      return Promise.resolve();
    };
    
    // Disable BPM detection - will receive from bridge
    audioManager.detectBPM = function() {
      console.log('[Visualizer] BPM detection disabled - waiting for bridge');
      // Return a promise that never resolves to prevent any BPM detection
      return new Promise(() => {});
    };
    
    // Disable audio playback
    audioManager.play = function() {
      this.isPlaying = true;
      console.log('[Visualizer] Play (controlled by bridge)');
    };
    
    audioManager.pause = function() {
      this.isPlaying = false;
      console.log('[Visualizer] Pause (controlled by bridge)');
    };
    
    audioManager.seek = function() {
      console.log('[Visualizer] Seek (controlled by bridge)');
    };
    
    console.log('[Visualizer] AudioManager configured for passive bridge mode');
  }
})();
