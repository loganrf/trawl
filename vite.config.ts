import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build:single` makes one self-contained HTML file (base map inlined).
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'single' ? [viteSingleFile()] : [],
  define: {
    __SINGLE_FILE__: JSON.stringify(mode === 'single'),
  },
  build: {
    outDir: mode === 'single' ? 'dist-single' : 'dist',
    chunkSizeWarningLimit: 2000,
    assetsInlineLimit: mode === 'single' ? 100_000_000 : 4096,
  },
}));
