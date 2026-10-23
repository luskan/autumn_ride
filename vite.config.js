import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build` produces a single self-contained dist/index.html
// relative base: the game is served from a sub-path on GitHub Pages
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
  server: { port: 5173 },
});
