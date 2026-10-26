import { defineConfig } from 'vite';

// Relative base so the build works both at a domain root and at a GitHub Pages
// project path (https://<user>.github.io/<repo>/).
export default defineConfig({
  base: './',
});
