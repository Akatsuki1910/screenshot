import { defineConfig } from 'vite';
import { CHROME_TARGET, sharedDefine } from './vite.shared';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));

/**
 * 拡張機能ページ（popup / offscreen）のビルド。
 * HTML をエントリにして ESM で出力する。public/ の manifest.json と icons もここでコピーされる。
 */
export default defineConfig({
  base: './',
  define: sharedDefine,
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: CHROME_TARGET,
    sourcemap: false,
    rollupOptions: {
      input: {
        popup: resolve(root, 'popup.html'),
        offscreen: resolve(root, 'offscreen.html')
      },
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]'
      }
    }
  }
});
