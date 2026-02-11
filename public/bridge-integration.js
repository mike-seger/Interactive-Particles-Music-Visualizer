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

  // Bridge audio watchdog (debug)
  window.__bridgeLastAudioDataAt = 0;
  window.__bridgeLastAudioAvg = 0;
  window.__bridgeLastAudioMax = 0;
  window.__bridgeWatchdogStarted = false;
  
  // Store BPM audio buffer received from bridge
  window.__bridgeBPMBuffer = null;
  
  // Hide UI elements if requested — but keep lil-gui controls accessible
  if (hideui) {
    const style = document.createElement('style');
    style.textContent = `
      .frame { display: none !important; }
      #player-controls { display: none !important; }
      .user_interaction { display: none !important; }
      .dg.ac { display: none !important; }

      /* Bridge mode: lil-gui starts collapsed, reveal on hover */
      .lil-gui.lil-root.bridge-collapsed > .lil-children { display: none; }
      .lil-gui.lil-root.bridge-collapsed .gui-title-close-btn { display: none !important; }
      .lil-gui.lil-root.bridge-collapsed {
        opacity: 0;
        transition: opacity 0.3s ease;
        pointer-events: auto;
      }
      .lil-gui.lil-root.bridge-collapsed:hover {
        opacity: 1;
      }
    `;
    document.head.appendChild(style);
    console.log('[Visualizer] UI elements hidden (bridge mode, controls on hover)');

    // Auto-collapse lil-gui once it appears in the DOM
    const collapseBridgeGui = () => {
      const guiRoot = document.querySelector('.lil-gui.lil-root');
      if (!guiRoot) return false;
      guiRoot.classList.add('bridge-collapsed');
      // Click anywhere on the collapsed title bar to fully expand
      guiRoot.addEventListener('click', function onExpand() {
        guiRoot.classList.remove('bridge-collapsed');
        guiRoot.classList.remove('gui-collapsed');
        const children = guiRoot.querySelector('.lil-children');
        if (children) children.style.display = '';
        const closeBtn = guiRoot.querySelector('.gui-title-close-btn');
        if (closeBtn) closeBtn.innerHTML = 'X';
      }, { once: true });
      return true;
    };

    if (!collapseBridgeGui()) {
      // GUI not in DOM yet — watch for it
      const obs = new MutationObserver(() => {
        if (collapseBridgeGui()) obs.disconnect();
      });
      obs.observe(document.body, { childList: true, subtree: true });
    }
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
            .dg.ac { display: none !important; }

            /* Bridge mode: lil-gui starts collapsed, reveal on hover */
            .lil-gui.lil-root.bridge-collapsed > .lil-children { display: none; }
            .lil-gui.lil-root.bridge-collapsed .gui-title-close-btn { display: none !important; }
            .lil-gui.lil-root.bridge-collapsed {
              opacity: 0;
              transition: opacity 0.3s ease;
              pointer-events: auto;
            }
            .lil-gui.lil-root.bridge-collapsed:hover {
              opacity: 1;
            }
          `;
          if (!document.getElementById('bridge-ui-hide')) {
            document.head.appendChild(style);
          }

          // Collapse lil-gui for bridge mode
          const guiRoot = document.querySelector('.lil-gui.lil-root');
          if (guiRoot && !guiRoot.classList.contains('bridge-collapsed')) {
            guiRoot.classList.add('bridge-collapsed');
            guiRoot.addEventListener('click', function onExpand() {
              guiRoot.classList.remove('bridge-collapsed');
              guiRoot.classList.remove('gui-collapsed');
              const children = guiRoot.querySelector('.lil-children');
              if (children) children.style.display = '';
              const closeBtn = guiRoot.querySelector('.gui-title-close-btn');
              if (closeBtn) closeBtn.innerHTML = 'X';
            }, { once: true });
          }
        }
        
        if (msg.autoStart) {
          setTimeout(() => {
            document.body.click();
          }, 100);
        }
        break;
        
      case 'AUDIO_DATA': {
        // Receive bridge audio. Prefer frequencyData; fall back to timeData->approx spectrum.
        const am = window.App && window.App.audioManager;
        const analyser = am && am.audioAnalyser;
        if (!analyser || !analyser.data) break;

        const hasFreq = !!msg.frequencyData;
        const hasTime = Array.isArray(msg.timeData) || ArrayBuffer.isView(msg.timeData);

        const toByteSpectrum = (payload) => {
          if (!payload) return null;

          // If the payload is an ArrayBuffer, it is assumed to already be byte spectrum.
          if (payload instanceof ArrayBuffer) {
            return new Uint8Array(payload);
          }

          // Typed arrays / DataViews
          if (ArrayBuffer.isView(payload)) {
            // If already bytes, use as-is.
            if (payload instanceof Uint8Array) return payload;

            // If it is a 1-byte-per-element typed view (e.g. Int8Array), reinterpret.
            if (payload.BYTES_PER_ELEMENT === 1) {
              return new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
            }

            // Float arrays are common when parent uses getFloatFrequencyData() or normalized bins.
            if (payload instanceof Float32Array || payload instanceof Float64Array) {
              // Detect whether it's normalized (0..1) or dB (negative).
              let min = Infinity;
              let max = -Infinity;
              for (let i = 0; i < payload.length; i++) {
                const v = payload[i];
                if (v < min) min = v;
                if (v > max) max = v;
              }

              const out = new Uint8Array(payload.length);
              if (max <= 1.5 && min >= 0) {
                // Normalized 0..1
                for (let i = 0; i < payload.length; i++) {
                  out[i] = Math.max(0, Math.min(255, Math.round(payload[i] * 255)));
                }
                return out;
              }

              if (max <= 0 && min < 0) {
                // Likely dB values (e.g. -100..0). Map to 0..255.
                const minDb = -100;
                const maxDb = 0;
                const range = maxDb - minDb;
                for (let i = 0; i < payload.length; i++) {
                  const clamped = Math.max(minDb, Math.min(maxDb, payload[i]));
                  out[i] = Math.max(0, Math.min(255, Math.round(((clamped - minDb) / range) * 255)));
                }
                return out;
              }

              // Fallback: clamp numeric values directly.
              for (let i = 0; i < payload.length; i++) {
                out[i] = Math.max(0, Math.min(255, Math.round(payload[i])));
              }
              return out;
            }

            // Other numeric typed arrays (Int16Array, Uint16Array, etc): clamp.
            try {
              const out = new Uint8Array(payload.length);
              for (let i = 0; i < payload.length; i++) {
                out[i] = Math.max(0, Math.min(255, Math.round(payload[i])));
              }
              return out;
            } catch {
              return null;
            }
          }

          // Plain JS array
          if (Array.isArray(payload)) {
            let min = Infinity;
            let max = -Infinity;
            for (let i = 0; i < payload.length; i++) {
              const v = Number(payload[i]);
              if (!Number.isFinite(v)) continue;
              if (v < min) min = v;
              if (v > max) max = v;
            }

            const out = new Uint8Array(payload.length);
            if (max <= 1.5 && min >= 0) {
              for (let i = 0; i < payload.length; i++) out[i] = Math.max(0, Math.min(255, Math.round(Number(payload[i]) * 255)));
              return out;
            }
            if (max <= 0 && min < 0) {
              const minDb = -100;
              const maxDb = 0;
              const range = maxDb - minDb;
              for (let i = 0; i < payload.length; i++) {
                const v = Number(payload[i]);
                const clamped = Math.max(minDb, Math.min(maxDb, v));
                out[i] = Math.max(0, Math.min(255, Math.round(((clamped - minDb) / range) * 255)));
              }
              return out;
            }
            for (let i = 0; i < payload.length; i++) out[i] = Math.max(0, Math.min(255, Math.round(Number(payload[i]) || 0)));
            return out;
          }

          return null;
        }

        const maybeLogIncoming = (payload, label) => {
          if (window.__bridgeAudioPayloadLogged) return;
          try {
            let len = null;
            let min = Infinity;
            let max = -Infinity;

            if (payload instanceof ArrayBuffer) {
              const view = new Uint8Array(payload);
              len = view.length;
              for (let i = 0; i < view.length; i++) {
                const v = view[i];
                if (v < min) min = v;
                if (v > max) max = v;
              }
            } else if (ArrayBuffer.isView(payload)) {
              len = payload.length;
              for (let i = 0; i < payload.length; i++) {
                const v = payload[i];
                if (v < min) min = v;
                if (v > max) max = v;
              }
            } else if (Array.isArray(payload)) {
              len = payload.length;
              for (let i = 0; i < payload.length; i++) {
                const v = Number(payload[i]);
                if (!Number.isFinite(v)) continue;
                if (v < min) min = v;
                if (v > max) max = v;
              }
            }

            window.__bridgeAudioPayloadLogged = true;
            console.log('[Visualizer] Bridge AUDIO_DATA payload sample', {
              label,
              type: payload && payload.constructor ? payload.constructor.name : typeof payload,
              length: len,
              min: Number.isFinite(min) ? min : null,
              max: Number.isFinite(max) ? max : null,
            });
          } catch {
            window.__bridgeAudioPayloadLogged = true;
          }
        }

        const writeFreq = (arr) => {
          const dst = analyser.data;
          if (!dst || !arr) return false;
          const n = Math.min(dst.length, arr.length);
          for (let i = 0; i < n; i++) dst[i] = arr[i];
          if (typeof refreshTimeDomainFromFreq === 'function') {
            try { refreshTimeDomainFromFreq(dst); } catch { /* ignore */ }
          }
          return true;
        }

        const writeFromPCM = (pcm) => {
          if (!pcm) return false;
          const dst = analyser.data;
          const len = dst.length;
          const chunk = Math.max(1, Math.floor(pcm.length / len));
          for (let i = 0; i < len; i++) {
            const start = i * chunk;
            let acc = 0;
            let c = 0;
            for (let j = 0; j < chunk && start + j < pcm.length; j++) {
              acc += Math.abs(pcm[start + j]);
              c++;
            }
            const avg = c ? acc / c : 0;
            dst[i] = Math.max(0, Math.min(255, Math.round(avg)));
          }
          if (typeof refreshTimeDomainFromPCM === 'function') {
            try { refreshTimeDomainFromPCM(pcm); } catch { /* ignore */ }
          }
          return true;
        }

        let handled = false;

        if (hasFreq) {
          try {
            maybeLogIncoming(msg.frequencyData, 'frequencyData');
            const data = toByteSpectrum(msg.frequencyData);
            handled = writeFreq(data);
          } catch (err) {
            console.warn('[Visualizer] Failed to apply frequencyData', err);
          }
        }

        if (!handled && hasTime) {
          try {
            const pcm = msg.timeData instanceof Uint8Array ? msg.timeData : new Uint8Array(msg.timeData);
            handled = writeFromPCM(pcm);
          } catch (err) {
            console.warn('[Visualizer] Failed to derive spectrum from timeData', err);
          }
        }

        if (handled && analyser && analyser.data) {
          // Track basic stats to help debug “silent” streams.
          const data = analyser.data;
          let sum = 0;
          let max = 0;
          for (let i = 0; i < data.length; i++) {
            const v = data[i] || 0;
            sum += v;
            if (v > max) max = v;
          }
          window.__bridgeLastAudioDataAt = Date.now();
          window.__bridgeLastAudioAvg = data.length ? sum / data.length : 0;
          window.__bridgeLastAudioMax = max;
        }

        if (!handled && (!window.__dataMissingLogged || Date.now() - window.__dataMissingLogged > 2000)) {
          console.warn('[Visualizer] ⚠️ App ready but audio payload missing usable data:', {
            hasFrequencyData: hasFreq,
            hasTimeData: hasTime,
            hasAnalyserData: !!analyser.data
          });
          window.__dataMissingLogged = Date.now();
        }
        break;
      }
        
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

    // Watchdog: warn if AUDIO_DATA stops arriving (or stays near-silent).
    // Throttled to avoid console spam.
    if (!window.__bridgeWatchdogStarted) {
      window.__bridgeWatchdogStarted = true;
      let lastWarnAt = 0;
      const warnEveryMs = 3000;
      const staleAfterMs = 1500;

      setInterval(() => {
        const now = Date.now();
        const last = window.__bridgeLastAudioDataAt || 0;
        if (!last || now - last > staleAfterMs) {
          if (now - lastWarnAt > warnEveryMs) {
            lastWarnAt = now;
            console.warn('[Visualizer] ⚠️ No bridge AUDIO_DATA received recently', {
              msSinceLast: last ? (now - last) : null,
              lastAvg: window.__bridgeLastAudioAvg,
              lastMax: window.__bridgeLastAudioMax,
              hint: 'Parent should postMessage({type:"AUDIO_DATA", frequencyData|timeData}) continuously.'
            });
          }
        } else {
          // Data is flowing; optionally warn about near-silence.
          const avg = window.__bridgeLastAudioAvg || 0;
          const max = window.__bridgeLastAudioMax || 0;
          if (max <= 2 && avg <= 0.5 && now - lastWarnAt > warnEveryMs) {
            lastWarnAt = now;
            console.warn('[Visualizer] ⚠️ Bridge AUDIO_DATA looks near-silent', {
              lastAvg: avg,
              lastMax: max,
              hint: 'Check parent analyser wiring / gain / CORS / muted element.'
            });
          }
        }
      }, 750);
    }
    
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
    const bridgeTimeArray = new Uint8Array(2048);
    let phaseLow = 0;
    let phaseMid = 0;
    let phaseHigh = 0;

    const bandAvg = (src, start, count) => {
      const len = src.length;
      if (start >= len || count <= 0) return 0;
      const end = Math.min(len, start + count);
      let sum = 0;
      for (let i = start; i < end; i++) sum += src[i];
      const n = end - start;
      return n ? (sum / n) : 0;
    };

    const scaleAmp = (v, minAmp, maxAmp) => {
      const norm = Math.max(0, v - 12) / 243; // damp tiny noise, map to 0..1
      return Math.min(maxAmp, Math.max(minAmp, minAmp + norm * (maxAmp - minAmp)));
    };

    function refreshTimeDomainFromFreq(srcArray) {
      if (!srcArray || !srcArray.length) return;

      const lowAvg = bandAvg(srcArray, 0, 96);          // ~0-375Hz depending on FFT size
      const midAvg = bandAvg(srcArray, 96, 192);        // mids
      const highAvg = bandAvg(srcArray, 288, 256);      // highs/tops

      const lowAmp = scaleAmp(lowAvg, 8, 110);
      const midAmp = scaleAmp(midAvg, 4, 70);
      const highAmp = scaleAmp(highAvg, 2, 36);

      const lowStep = 0.010 + lowAvg * 0.00015;
      const midStep = 0.032 + midAvg * 0.0002;
      const highStep = 0.085 + highAvg * 0.00025;

      for (let i = 0; i < bridgeTimeArray.length; i++) {
        const sLow = Math.sin(phaseLow + i * lowStep);
        const sMid = Math.sin(phaseMid + i * midStep);
        const sHigh = Math.sin(phaseHigh + i * highStep);
        const noise = (Math.random() - 0.5) * 6;
        const val = 128 + sLow * lowAmp + sMid * midAmp + sHigh * highAmp + noise;
        bridgeTimeArray[i] = Math.max(0, Math.min(255, Math.floor(val)));
      }

      phaseLow += lowStep * bridgeTimeArray.length;
      phaseMid += midStep * bridgeTimeArray.length;
      phaseHigh += highStep * bridgeTimeArray.length;
    }

    function refreshTimeDomainFromPCM(srcArray) {
      if (!srcArray || !srcArray.length) return false;
      const len = Math.min(srcArray.length, bridgeTimeArray.length);
      for (let i = 0; i < len; i++) {
        bridgeTimeArray[i] = srcArray[i];
      }
      // If incoming shorter, pad with midpoint.
      for (let i = len; i < bridgeTimeArray.length; i++) {
        bridgeTimeArray[i] = 128;
      }
      return len > 0;
    }
    
    if (window.AnalyserNode && window.AnalyserNode.prototype) {
      const originalGetByteFrequencyData = window.AnalyserNode.prototype.getByteFrequencyData;
      
      window.AnalyserNode.prototype.getByteFrequencyData = function(array) {
        // Copy bridge data into the array being requested
        if (bridgeDataArray && array) {
          const length = Math.min(bridgeDataArray.length, array.length);
          for (let i = 0; i < length; i++) {
            array[i] = bridgeDataArray[i];
          }
        }
        // Don't call original - we're providing all the data
      };

      window.AnalyserNode.prototype.getByteTimeDomainData = function(array) {
        if (bridgeTimeArray && array) {
          const length = Math.min(bridgeTimeArray.length, array.length);
          for (let i = 0; i < length; i++) {
            array[i] = bridgeTimeArray[i];
          }
        }
      };

      window.AnalyserNode.prototype.getFloatFrequencyData = function(array) {
        // Use the most current data source available
        const activeData = (window.App && window.App.audioManager && window.App.audioManager.audioAnalyser && window.App.audioManager.audioAnalyser.data)
          ? window.App.audioManager.audioAnalyser.data
          : bridgeDataArray;

        if (activeData && array) {
          const length = Math.min(activeData.length, array.length);
          // Convert byte (0..255) to float dB (typically -100..-30)
          // Optimization: If minDb is default (-100), lift it to -90.
          // This ensures that low-amplitude movements (visible in byte mode) 
          // don't get gated out by visualizers with -90dB thresholds.
          let minDb = this.minDecibels !== undefined ? this.minDecibels : -100;
          if (minDb < -90) minDb = -90;
          
          const maxDb = this.maxDecibels !== undefined ? this.maxDecibels : -30;
          const range = maxDb - minDb;
          
          for (let i = 0; i < length; i++) {
            // activeData is 0-255 representing signal strength
            const norm = activeData[i] / 255;
            array[i] = minDb + (norm * range);
          }
        }
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
