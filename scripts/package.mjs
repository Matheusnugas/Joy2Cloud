// Builds two zips in dist/:
//   joy2cloud-v<version>.zip        for GitHub Releases (contains the extension/ folder)
//   joy2cloud-v<version>-store.zip  for the Chrome Web Store (manifest.json at the root)
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const { version } = JSON.parse(readFileSync(new URL('../extension/manifest.json', import.meta.url)));
mkdirSync(`${root}dist`, { recursive: true });

const release = `${root}dist/joy2cloud-v${version}.zip`;
const store = `${root}dist/joy2cloud-v${version}-store.zip`;
rmSync(release, { force: true });
rmSync(store, { force: true });
execFileSync('zip', ['-qr', release, 'extension', '-x', '*.DS_Store'], { cwd: root });
execFileSync('zip', ['-qr', store, '.', '-x', '*.DS_Store'], { cwd: `${root}extension` });
console.log(release);
console.log(store);
