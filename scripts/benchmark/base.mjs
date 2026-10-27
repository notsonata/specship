import { treeContents } from './accounting.mjs';

// Prepared evaluator images can contain source edits as well as installed
// dependencies. Restore only tracked source, inside the disposable task checkout.
export function prepareBase(command, baseCommit) {
  if (!/^[a-f0-9]{40}$/.test(baseCommit)) throw Error('Invalid benchmark base commit');
  const preparedHead = command('git', ['rev-parse', 'HEAD']).trim();
  const expected = treeContents(command('git', ['ls-tree', '-rz', baseCommit]));
  const actual = treeContents(command('git', ['ls-tree', '-rz', 'HEAD']));
  const restored = JSON.stringify(expected) !== JSON.stringify(actual);
  if (restored) command('git', ['reset', '--hard', baseCommit]);
  const verified = treeContents(command('git', ['ls-tree', '-rz', 'HEAD']));
  if (JSON.stringify(expected) !== JSON.stringify(verified)) throw Error(`Image content differs from the declared base commit: ${baseCommit}`);
  command('git', ['-c', 'core.fileMode=false', 'diff', '--quiet']);
  return { image_head: command('git', ['rev-parse', 'HEAD']).trim(), prepared_image_head: preparedHead, base_restored: restored };
}
