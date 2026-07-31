import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));

/**
 * service worker のビルド。単一ファイルの classic script として出力する。
 */
export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'chrome109',
    sourcemap: false,
    lib: {
      entry: resolve(root, 'src/background/main.ts'),
      formats: ['iife'],
      name: '__ElementScreenshotBackground',
      fileName: () => 'background.js'
    }
  }
});
