import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));

/**
 * content script のビルド。
 * chrome.scripting.executeScript({ files }) で注入されるため ESM は使えない。
 * html2canvas も含めて 1 ファイルの IIFE にバンドルする。
 */
export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'chrome109',
    sourcemap: false,
    lib: {
      entry: resolve(root, 'src/content/main.ts'),
      formats: ['iife'],
      name: '__ElementScreenshotContent',
      fileName: () => 'content.js'
    }
  }
});
