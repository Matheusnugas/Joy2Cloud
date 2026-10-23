// Builds dist/joy2cloud-v<version>.zip from extension/ for a GitHub release.
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const { version } = JSON.parse(readFileSync(new URL('../extension/manifest.json', import.meta.url)));
mkdirSync(`${root}dist`, { recursive: true });
const out = `${root}dist/joy2cloud-v${version}.zip`;
rmSync(out, { force: true });
execFileSync('zip', ['-qr', out, 'extension', '-x', '*.DS_Store'], { cwd: root });
console.log(out);
