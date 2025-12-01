import { customUnitPxp } from '@lemonneko/postcss-plugin-pxp'
import { createPxpCompilerPlugin } from '@lemonneko/vue-compiler-plugin-pxp'
import vue from '@vitejs/plugin-vue'
import unocss from 'unocss/vite'
import { defineConfig } from 'vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import vueDevTools from 'vite-plugin-vue-devtools'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    vue({
      template: {
        compilerOptions: {
          nodeTransforms: [
            createPxpCompilerPlugin('--viewport-width', '720'),
          ],
        },
      },
    }),
    unocss(),
    vueDevTools(),
    nodePolyfills(),
  ],
  css: {
    transformer: 'postcss',
    postcss: {
      plugins: [
        customUnitPxp('--viewport-width', '720'),
      ],
    },
  },
  server: {
    port: 6173,
  },
  test: {
    globals: true,
    environment: 'jsdom',
  },
})
