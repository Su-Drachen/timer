// Explicit public dependencies only. Never fetch Gist content or browser credentials.
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../assets/vendor/', import.meta.url);
const files = [
  ['https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js', 'chart.umd.min.js'],
  ['https://cdn.jsdelivr.net/npm/chart.js@4.5.1/LICENSE.md', 'chart-LICENSE.md'],
  ['https://cdn.jsdelivr.net/npm/tailwindcss@3.4.17/LICENSE', 'tailwind-LICENSE.txt'],
  ['https://openfontlicense.org/documents/OFL.txt', 'font-awesome-OFL.txt'],
  ['https://cdn.jsdelivr.net/npm/font-awesome@4.7.0/css/font-awesome.min.css', 'font-awesome.min.css'],
  ['https://cdn.jsdelivr.net/npm/font-awesome@4.7.0/fonts/fontawesome-webfont.woff2', 'fonts/fontawesome-webfont.woff2']
];

for (const [source, name] of files) {
  const response = await fetch(source, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Cannot fetch ${name}: HTTP ${response.status}`);
  let bytes = new Uint8Array(await response.arrayBuffer());
  if (name === 'font-awesome-OFL.txt') {
    const text = new TextDecoder().decode(bytes);
    const licenseStart = text.indexOf('This Font Software is licensed');
    if (licenseStart === -1) throw new Error('Unexpected OFL license format');
    bytes = new TextEncoder().encode('Copyright (c) Dave Gandy (https://fontawesome.com/v4/)\n\n' + text.slice(licenseStart));
  }
  if (name === 'font-awesome.min.css') {
    // Modern target browsers support WOFF2; keep the font entirely same-origin.
    const css = new TextDecoder().decode(bytes).replace(
      /@font-face\{[^}]+\}/,
      "@font-face{font-family:'FontAwesome';src:url('./fonts/fontawesome-webfont.woff2') format('woff2');font-weight:normal;font-style:normal;font-display:block}"
    );
    bytes = new TextEncoder().encode(css);
  }
  const target = new URL(name, root);
  await mkdir(fileURLToPath(new URL('.', target)), { recursive: true });
  await writeFile(target, bytes);
  console.log(`${name}: ${bytes.byteLength} bytes`);
}
