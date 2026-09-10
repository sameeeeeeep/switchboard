// Static export of the landing (V2 + /developers) for GitHub Pages under /switchboard/.
// Plain Vite + SSR prerender — no Sites/Cloudflare/vinext runtime.
import path from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import { defineConfig, type Plugin } from 'vite';

export const BASE = '/switchboard/';
const ROOT = path.resolve(import.meta.dirname, '..');

// Root-relative asset + route refs in the source → destination base path.
// SSR needs no CSS output — stub every stylesheet so tailwind's postcss never runs server-side.
function ssrNoCss(): Plugin {
  return {
    name: 'switchboard-ssr-no-css',
    enforce: 'pre',
    resolveId(id, _importer, opts) { if (opts?.ssr && /\.css$/.test(id)) return '\0nocss'; return null; },
    load(id) { return id === '\0nocss' ? 'export default {}' : null; },
  };
}

function basePath(): Plugin {
  return {
    name: 'switchboard-base-path',
    enforce: 'pre',
    transform(code, id) {
      if (!/\.(tsx?|css)$/.test(id) || id.includes('node_modules')) return null;
      let out = code
        .replace(/(['"(])\/(wrapps|product-captures|brands|connectors|fonts)\//g, `$1${BASE}$2/`)
        .replace(/(['"])\/developers(['"])/g, `$1${BASE}developers/$2`)
        .replace(/(['"])\/v2(['"])/g, `$1${BASE}$2`);
      return out === code ? null : { code: out, map: null };
    },
  };
}

export default defineConfig(({ isSsrBuild }) => ({
  root: ROOT,
  base: BASE,
  publicDir: false, // copied by prerender.mjs
  css: isSsrBuild ? undefined : { postcss: { plugins: [tailwindcss({ base: ROOT })] } },
  resolve: { alias: { '@': ROOT } },
  plugins: [ssrNoCss(), basePath(), react()],
  build: {
    outDir: isSsrBuild ? path.join(ROOT, 'static/out/server') : path.join(ROOT, 'static/out/client'),
    emptyOutDir: true,
    manifest: !isSsrBuild,
    rollupOptions: { input: path.join(ROOT, isSsrBuild ? 'static/entry-server.tsx' : 'static/entry-client.tsx') },
  },
}));
