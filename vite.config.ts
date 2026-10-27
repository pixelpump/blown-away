import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset paths so the build works from any sub-path (Shepherd route, static host).
  base: './',
  build: {
    // GAME=mow builds the mowing prototype (mow.html) instead of Blown Away.
    outDir: process.env.GAME === 'mow' ? 'dist-mow' : 'dist',
    rollupOptions: { input: process.env.GAME === 'mow' ? 'mow.html' : 'index.html' },
    // Phaser is ~1.2 MB unminified; it is only loaded when the game is opened.
    chunkSizeWarningLimit: 1600,
    // Inline every sprite (all small) so the game is one JS file plus CSS:
    // nothing extra to serve when embedding it.
    assetsInlineLimit: 64 * 1024,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
