import { defineConfig } from 'vite'
import glslify from 'rollup-plugin-glslify'
import * as path from 'path'

export default defineConfig({
  root: '',
  base: '/visualizer/',
  css: {
    preprocessorOptions: {
      scss: {
        api: 'modern-compiler',
      },
    },
  },
  build: {
    outDir: 'dist',
    cssCodeSplit: true,
    // milkdrop-presets (~645 kB) and three.js (~477 kB) are the largest chunks.
    // Both are lazy-loaded or cache-stable; suppress the default 500 kB warning.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      input: {
        visualizer: './index.html',
        canvas: './canvas.html',
        gui: './gui.html',
        bridge: './bridge.html',
      },
      output: {
        manualChunks(id) {
          if (!id) return

          // Split out large in-repo assets (GLSL + visualizers) to keep the app
          // entry chunk smaller. (These are still loaded up-front for now, but
          // will be separate cached chunks.)
          const normalized = id.replace(/\\/g, '/')
          if (normalized.includes('/src/shaders/')) return 'shaders'

          // Keep entities + visualizers together to avoid circular chunk
          // dependencies (visualizers <-> entities).
          if (normalized.includes('/src/js/visualizers/') || normalized.includes('/src/js/entities/')) {
            return 'visuals'
          }

          if (!id.includes('node_modules')) return

          // Keep large deps in their own chunks so the app chunk stays smaller
          // and caches better when app code changes.
          if (id.includes('/three/')) return 'three'
          if (id.includes('/dat.gui/')) return 'datgui'
          if (id.includes('/gsap/')) return 'gsap'
          if (id.includes('/web-audio-beat-detector/')) return 'beat-detector'
          if (id.includes('/butterchurn-presets/')) return 'milkdrop-presets'
          if (id.includes('/butterchurn/')) return 'milkdrop-engine'

          return 'vendor'
        },
      },
    },
  },
  server: {
    host: true,
  },
  resolve: {
    dedupe: ['three'],
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  plugins: [glslify()],
})
