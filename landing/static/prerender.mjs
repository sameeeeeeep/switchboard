// node static/prerender.mjs [destDir]  — builds client+ssr, prerenders each route, copies public/.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'static/out');
const dest = process.argv[2] ? path.resolve(process.argv[2]) : path.join(out, 'site');
const BASE = '/switchboard/';
const run = c => execSync(c, { cwd: root, stdio: 'inherit' });
run('npx vite build --config static/vite.static.config.ts');
run('npx vite build --config static/vite.static.config.ts --ssr static/entry-server.tsx');

const { render, routes } = await import(path.join(out, 'server/entry-server.js'));
const manifest = JSON.parse(fs.readFileSync(path.join(out, 'client/.vite/manifest.json'), 'utf8'));
const entry = Object.values(manifest).find(m => m.isEntry);
const css = (entry.css ?? []).map(f => `<link rel="stylesheet" href="${BASE}${f}">`).join('\n');
const js = `<script type="module" src="${BASE}${entry.file}"></script>`;

fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });
fs.cpSync(path.join(out, 'client/assets'), path.join(dest, 'assets'), { recursive: true });
for (const d of fs.readdirSync(path.join(root, 'public'))) fs.cpSync(path.join(root, 'public', d), path.join(dest, d), { recursive: true });
for (const f of fs.readdirSync(dest).filter(n => n === 'SOURCES.md')) fs.rmSync(path.join(dest, f));

for (const r of routes) {
  const { html, title, description } = render(r.path);
  const url = `https://thelastprompt.ai${BASE}${r.path.replace(/^\//, '')}`;
  const doc = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8">
<meta name="google-site-verification" content="QWNvZV25SwA6QShgioOIhmtgE9hVY2u63mK03ZEYLHw" />
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<meta name="description" content="${description.replace(/"/g, '&quot;')}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="website">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description.replace(/"/g, '&quot;')}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="https://thelastprompt.ai/og.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="${BASE}favicon.svg" type="image/svg+xml">
<link rel="preload" href="${BASE}fonts/Doto.ttf" as="font" type="font/ttf" crossorigin>
${css}
</head><body><div id="root">${html}</div>
${js}
</body></html>
`;
  const file = path.join(dest, r.out);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, doc);
  console.log('wrote', path.relative(root, file), (doc.length / 1024).toFixed(0) + 'KB');
}
console.log('static site →', dest);
