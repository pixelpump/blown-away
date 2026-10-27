import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset paths so the build works from any sub-path (Shepherd route, static host).
  base: './',
  build: {
    // Phaser is ~1.2 MB unminified; it is only loaded when the game is opened.
    chunkSizeWarningLimit: 1600,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
