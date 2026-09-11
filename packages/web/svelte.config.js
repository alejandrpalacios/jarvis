import adapter from '@sveltejs/adapter-auto';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    // adapter-auto detecta Vercel al desplegar. Si mas adelante quieres
    // pinearlo como en nidohomes, cambia a @sveltejs/adapter-vercel.
    adapter: adapter(),
  },
};

export default config;
