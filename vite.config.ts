import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// base './' lets the built app run from any folder (e.g. GitHub Pages or a USB stick)
export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'StabilitySoft — Vessel Stability',
        short_name: 'StabilitySoft',
        description: 'Intact stability calculations (IMO IS Code 2008), offline-capable.',
        theme_color: '#16191C',
        background_color: '#16191C',
        display: 'standalone',
        start_url: '.',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: { globPatterns: ['**/*.{js,css,html,svg}'] },
    }),
  ],
  test: { include: ['tests/**/*.test.ts'] },
});
