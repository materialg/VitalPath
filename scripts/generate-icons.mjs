import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const src = resolve(root, 'logo-source.svg');
const out = resolve(root, 'public');

const svg = readFileSync(src);

const tasks = [
  { name: 'apple-touch-icon.png', size: 180, flatten: '#141414' },
  { name: 'icon-192.png', size: 192, flatten: '#141414' },
  { name: 'icon-512.png', size: 512, flatten: '#141414' },
  { name: 'favicon-32.png', size: 32, flatten: '#141414' },
];

for (const t of tasks) {
  await sharp(svg)
    .resize(t.size, t.size)
    .flatten({ background: t.flatten })
    .png()
    .toFile(resolve(out, t.name));
  console.log(`wrote ${t.name} (${t.size}x${t.size})`);
}

const icoBuf = await pngToIco([resolve(out, 'favicon-32.png')]);
writeFileSync(resolve(out, 'favicon.ico'), icoBuf);
console.log('wrote favicon.ico');
