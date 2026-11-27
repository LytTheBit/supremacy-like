import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    // The game logic (session) is tested without a browser.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
