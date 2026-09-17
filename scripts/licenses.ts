import { createRequire } from 'node:module';
import { dirname, join, isAbsolute } from 'node:path';
import { readdir } from 'node:fs/promises';

// Preserve notices embedded with vendored code, without traversing dependencies
// or symlinks. Each dependency is visited separately below.
async function licenseFiles(directory: string, prefix = ''): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== '.git') {
      files.push(...await licenseFiles(join(directory, entry.name), relative));
    } else if (entry.isFile() && /^(license|copying|notice)([.-]|$)/i.test(entry.name)) files.push(relative);
  }
  return files.sort();
}

// Follow only runtime dependencies; omit test/build tooling from shipped notices.
export async function bundleLicenses() {
  const seen = new Set<string>();
  const index: { name: string; version: string; license: unknown; files: string[] }[] = [];
  async function visit(name: string, parent: string) {
    const require = createRequire(parent);
    let entry: string;
    try { entry = require.resolve(`${name}/package.json`); }
    catch { entry = require.resolve(name); }
    if (!isAbsolute(entry)) throw new Error(`Cannot resolve installed package: ${name}`);
    let directory = dirname(entry);
    let manifest;
    while (true) {
      const file = Bun.file(join(directory, 'package.json'));
      if (await file.exists()) {
        const candidate = await file.json();
        if (candidate.name === name) { manifest = candidate; break; }
      }
      if (directory === dirname(directory)) throw new Error(`Cannot locate license package: ${name}`);
      directory = dirname(directory);
    }
    const identity = `${manifest.name}@${manifest.version}`;
    if (seen.has(identity)) return;
    seen.add(identity);
    const files = await licenseFiles(directory);
    for (const file of files) await Bun.write(`apps/extension/dist/licenses/${identity}/${file}`, Bun.file(join(directory, file)));
    index.push({ name: manifest.name, version: manifest.version, license: manifest.license, files });
    for (const dependency of Object.keys(manifest.dependencies ?? {})) await visit(dependency, join(directory, 'package.json'));
  }
  const root = new URL('../package.json', import.meta.url);
  const manifest = await Bun.file(root).json();
  for (const name of Object.keys(manifest.dependencies)) await visit(name, root.pathname);
  await Bun.write('apps/extension/dist/licenses/index.json', JSON.stringify(index, null, 2));
}
