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
          } else {
            // Debug: what's missing?
            if (!window.__dataMissingLogged || Date.now() - window.__dataMissingLogged > 2000) {
              console.warn('[Visualizer] ⚠️ App ready but data structure missing:', {
                hasFrequencyData: !!msg.frequencyData,
                hasAnalyserData: !!window.App.audioManager.audioAnalyser.data
              });
              window.__dataMissingLogged = Date.now();
            }
          }
        } else {
          // Debug: what specifically is missing?
          if (!window.__audioDataWarningLogged || Date.now() - window.__audioDataWarningLogged > 2000) {
            console.log('[Visualizer] ⏳ Audio data received but App not ready:', {
              hasApp: !!window.App,
              hasAudioManager: !!(window.App && window.App.audioManager),
              hasAudioAnalyser: !!(window.App && window.App.audioManager && window.App.audioManager.audioAnalyser)
            });
            window.__audioDataWarningLogged = Date.now();
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
  
  // In bridge mode, create fake App structure for audio data
  if (bridgeMode) {
    console.log('[Visualizer] Setting up passive bridge mode');
    
    // Create fake App.audioManager structure immediately
    window.App = {
      audioManager: {
        audioContext: null,
        audioAnalyser: {
          data: new Uint8Array(2048),  // FFT size from bridge
          getFrequencyData: function() {
            return this.data;
          }
        },
        bpm: 120,
        isPlaying: false,
        
        // Stub methods that might be called
        loadAudioBuffer: async function(onProgress = null) {
          console.log('[Visualizer] loadAudioBuffer bypassed - using bridge data');
          if (onProgress) onProgress(100, true);
          return Promise.resolve();
        },
        
        detectBPM: async function() {
          console.log('[Visualizer] detectBPM bypassed - using bridge BPM');
          return Promise.resolve();
        },
        
        play: function() {
          this.isPlaying = true;
        },
        
        pause: function() {
          this.isPlaying = false;
        },
        
        seek: function() {}
      },
      
      particleManager: {
        active: false,
        setActive: function(active) {
          this.active = active;
          console.log('[Visualizer] Particles', active ? 'activated' : 'deactivated');
        }
      }
    };
    
    console.log('[Visualizer] ✓ Created App structure for bridge mode:', window.App);
    
    // Patch Web Audio API to inject our bridge data
    // The visualizer's App runs in module scope, so we can't access it directly
    // Instead, intercept at the AnalyserNode level
    const bridgeDataArray = window.App.audioManager.audioAnalyser.data;
    
    if (window.AnalyserNode && window.AnalyserNode.prototype) {
      const originalGetByteFrequencyData = window.AnalyserNode.prototype.getByteFrequencyData;
      
      window.AnalyserNode.prototype.getByteFrequencyData = function(array) {
        // Copy bridge data into the array being requested
        if (bridgeDataArray && array) {
          const length = Math.min(bridgeDataArray.length, array.length);
          for (let i = 0; i < length; i++) {
            array[i] = bridgeDataArray[i];
          }
          
          // Log occasionally to confirm patching works
          if (Math.random() < 0.005) {
            console.log('[Visualizer] 🎨 Injected bridge data into analyser, sample:', array.slice(0, 5));
          }
        }
        // Don't call original - we're providing all the data
      };
      
      console.log('[Visualizer] ✓ Patched AnalyserNode.getByteFrequencyData');
    }
    
    // Intercept audio element creation to prevent actual audio loading
    const originalCreateElement = document.createElement.bind(document);
    document.createElement = function(tagName) {
      const element = originalCreateElement(tagName);
      
      if (tagName.toLowerCase() === 'audio') {
        console.log('[Visualizer] Audio element created - neutering it');
        element.volume = 0;
        element.muted = true;
        
        const noop = () => {};
        const noopPromise = () => Promise.resolve();
        
        element.play = noopPromise;
        element.pause = noop;
        
        element.load = function() {
          console.log('[Visualizer] Audio load() bypassed');
          setTimeout(() => {
            this.dispatchEvent(new Event('loadedmetadata'));
            this.dispatchEvent(new Event('loadeddata'));
            this.dispatchEvent(new Event('canplay'));
          }, 10);
        };
        
        Object.defineProperty(element, 'src', {
          get: () => '',
          set: (value) => {
            console.log('[Visualizer] Audio src blocked:', value);
            setTimeout(() => {
              element.dispatchEvent(new Event('loadedmetadata'));
              element.dispatchEvent(new Event('loadeddata'));
              element.dispatchEvent(new Event('canplay'));
            }, 10);
            return '';
          }
        });
        
        element.addEventListener('error', (e) => {
          e.stopPropagation();
          e.preventDefault();
          return false;
        }, true);
      }
      
      return element;
    };
  }
})();
