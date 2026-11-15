import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build`        → normal static site in dist/
// `npm run build:single` → one self-contained HTML in dist-single/ that opens
//                          by double-click (file://), e.g. to share on Discord.
export default defineConfig(({ mode }) => {
  const single = mode === 'single';
  return {
    base: './',
    plugins: single ? [viteSingleFile()] : [],
    build: {
      target: 'es2020',
      chunkSizeWarningLimit: 900,
      outDir: single ? 'dist-single' : 'dist',
      ...(single ? { assetsInlineLimit: 100_000_000 } : {}),
    },
    server: { port: 5173 },
  };
});
