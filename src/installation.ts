import { access, lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function localInstallation(workspace: string): Promise<{ root: string; cli: string }> {
  const root = join(workspace, '.specship', 'runtime');
  const cli = join(root, 'dist', 'cli.js');
  try {
    const entry = await lstat(root);
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error('Runtime root must be a real directory');
    const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    if (manifest.name !== 'specship') throw new Error('Runtime package is not Specship');
    await access(cli);
    await access(join(root, 'node_modules', '@modelcontextprotocol', 'sdk', 'package.json'));
    await access(join(root, '.agents', 'skills', 'ship', 'SKILL.md'));
  } catch (error) {
    throw new Error(`Install and build Specship in ${root} before running setup (clone the redesign branch there, then run npm ci and npm run build). Existing run data is preserved.`, { cause: error });
  }
  return { root, cli };
}
