import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://bharatki-economy.netlify.app',
  vite: {
    plugins: [tailwindcss()],
  },
});
