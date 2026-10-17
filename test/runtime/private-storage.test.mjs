import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, link, lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Store } from '../../dist/state.js';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'specship-private-'));
  t.after(async () => {
    const path = await realpath(root);
    assert.equal(dirname(path), await realpath(tmpdir()));
    assert.ok(basename(path).startsWith('specship-private-'));
    await rm(path, { recursive: true, force: true });
  });
  return root;
}

test('existing private state is restricted and every new credential/state file stays private', async t => {
  const root = await fixture(t), directory = join(root, '.specship');
  await mkdir(join(directory, 'runs', 'old'), { recursive: true });
  const old = join(directory, 'runs', 'old', 'adapter.json');
  await writeFile(old, '{"password":"test-only"}');
  if (process.platform !== 'win32') { await chmod(directory, 0o755); await chmod(old, 0o644); }
  const store = new Store(root); await store.initialize();
  const state = await store.create();
  await store.writePrivate(state.run_id, 'adapter.json', { password: 'fixture' });
  await store.writeCallbackDescriptor(state.run_id, { capability: 'fixture' });
  await store.publishInterruptDescriptor({ run_id: state.run_id, capability: 'fixture' });
  await store.claimWriter(state.run_id);
  const release = await store.lock();
  try {
    const files = [old, join(store.runDir(state.run_id), 'state.json'), join(store.runDir(state.run_id), 'adapter.json'), store.callbackDescriptorPath(state.run_id), join(directory, 'active-run.json'), join(directory, 'active-writer.json'), join(directory, 'writer.lock')];
    const directories = [directory, join(directory, 'runs'), join(directory, 'artifacts'), store.runDir(state.run_id)];
    if (process.platform !== 'win32') {
      for (const path of directories) { const stat = await lstat(path); assert.equal(stat.mode & 0o777, 0o700); assert.equal(stat.uid, process.getuid()); }
      for (const path of files) assert.equal((await lstat(path)).mode & 0o777, 0o600);
    } else {
      const paths = JSON.stringify([...directories, ...files]).replace(/'/g, "''");
      const script = `$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; $allowed=@($sid,'S-1-5-18','S-1-5-32-544'); $paths=ConvertFrom-Json '${paths}'; foreach($path in $paths){ $acl=Get-Acl -LiteralPath $path; if($acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $sid){throw 'wrong owner'}; foreach($rule in $acl.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])){if($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -notin $allowed){throw "unexpected reader: $path"}} }; Write-Output 'ACL checks passed'`;
      const result = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true });
      assert.match(result, /ACL checks passed/);
    }
  } finally { await release(); }
});

test('private storage refuses a linked root without changing its target', async t => {
  const root = await fixture(t), target = join(root, 'outside');
  await mkdir(target); await writeFile(join(target, 'sentinel'), 'keep');
  const before = await lstat(target);
  await symlink(target, join(root, '.specship'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(new Store(root).initialize(), /must not contain links/);
  assert.equal(await readFile(join(target, 'sentinel'), 'utf8'), 'keep');
  assert.equal((await lstat(target)).mode, before.mode);
});

test('existing nested links and hard links are rejected before private files are reused', async t => {
  const root = await fixture(t), directory = join(root, '.specship'), outside = join(root, 'outside');
  await mkdir(directory); await mkdir(outside);
  await symlink(outside, join(directory, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(new Store(root).initialize(), /must not contain links/);
  await rm(join(directory, 'linked'));
  await writeFile(join(outside, 'file'), 'keep');
  await link(join(outside, 'file'), join(directory, 'hardlink'));
  await assert.rejects(new Store(root).initialize(), /must not contain links/);
  assert.equal(await readFile(join(outside, 'file'), 'utf8'), 'keep');
});
