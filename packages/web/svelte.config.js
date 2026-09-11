import adapter from '@sveltejs/adapter-vercel';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    // runtime fijo: evita que el adapter intente usar nodejs24.x (aun no
    // soportado como runtime de funcion) solo porque el build corre con
    // Node 24 -- mismo fix que en nidohomes.
    adapter: adapter({ runtime: 'nodejs22.x' }),
  },
};

export default config;
