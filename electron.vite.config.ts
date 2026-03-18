import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'));
const deps = Object.keys(pkg.dependencies || {});
const externalDeps = ['electron', ...deps];
const externalPattern = new RegExp(`^(${externalDeps.join('|')})(/.*)?$`);

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          'mcp-qa-server': resolve(__dirname, 'src/main/mcp/qa-server.ts'),
          'mcp-zeus-bridge': resolve(__dirname, 'src/main/mcp/zeus-bridge.ts'),
        },
        external: (id) => externalPattern.test(id),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    server: {
      port: 5199,
    },
    build: {
      modulePreload: { polyfill: false },
    },
    plugins: [
      react(),
      tailwindcss(),
      // Strip crossorigin from built HTML — ngrok free-tier interstitial
      // sets a cookie that crossorigin="anonymous" strips from asset requests,
      // causing JS/CSS to fail loading on mobile via tunnel.
      {
        name: 'strip-crossorigin',
        transformIndexHtml(html) {
          return html.replace(/ crossorigin/g, '');
        },
      },
    ],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src'),
      },
    },
  },
});
