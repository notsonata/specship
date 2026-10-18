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
      const script = `
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
Import-Module "$PSHOME\\Modules\\Microsoft.PowerShell.Security\\Microsoft.PowerShell.Security.psd1" -ErrorAction Stop
$identity=[System.Security.Principal.WindowsIdentity]::GetCurrent()
$sid=$identity.User.Value
$owners=@($sid,$identity.Owner.Value)
$allowed=@($sid,'S-1-5-18','S-1-5-32-544')
$paths=ConvertFrom-Json '${paths}'
foreach($path in $paths){
  $acl=Get-Acl -LiteralPath $path
  # New files inherit the restricted DACL but use their creating token's default owner.
  if($acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -notin $owners){throw "wrong owner: $path"}
  foreach($rule in $acl.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])){
    if($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -notin $allowed){throw "unexpected reader: $path"}
  }
}
Write-Output 'ACL checks passed'
`;
      const result = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true });
      assert.match(result, /ACL checks passed/);
    }
  } finally { await release(); }
});

test('Windows ACL initialization ignores incompatible security modules inherited from its parent', {skip:process.platform!=='win32'},async t=>{
  const root=await fixture(t), modules=join(root,'modules'), security=join(modules,'Microsoft.PowerShell.Security');
  await mkdir(security,{recursive:true});
  await writeFile(join(security,'Microsoft.PowerShell.Security.psd1'),"@{ModuleVersion='99.0.0';RootModule='broken.psm1';FunctionsToExport=@('Get-Acl')}\n");
  await writeFile(join(security,'broken.psm1'),"throw 'Incompatible parent security module loaded'\nfunction Get-Acl {}\n");
  const env={...process.env,PSModulePath:modules};
  // Establish that automatic discovery really would select the incompatible module.
  assert.throws(()=>execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; Get-Acl ."],{env,stdio:'pipe',windowsHide:true}));
  const script="import { Store } from './dist/state.js'; await new Store(process.argv[1]).initialize();";
  execFileSync(process.execPath,['--input-type=module','-e',script,root],{env,stdio:'pipe',windowsHide:true});
  assert.ok((await lstat(join(root,'.specship','runs'))).isDirectory());
});

test('Windows storage accepts the current token default owner and normalizes it to the user', {skip:process.platform!=='win32'},async t=>{
  const root=await fixture(t), directory=join(root,'.specship');await mkdir(directory);
  const path=directory.replace(/'/g,"''");
  const prefix=`$ErrorActionPreference='Stop'; Import-Module "$PSHOME\\Modules\\Microsoft.PowerShell.Security\\Microsoft.PowerShell.Security.psd1" -ErrorAction Stop; $identity=[System.Security.Principal.WindowsIdentity]::GetCurrent(); $item=Get-Item -LiteralPath '${path}';`;
  const prepare=prefix+" $acl=$item.GetAccessControl(); $acl.SetOwner($identity.Owner); $item.SetAccessControl($acl); if($item.GetAccessControl().GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $identity.Owner.Value){throw 'default owner was not applied'}";
  const run=script=>execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{stdio:'pipe',windowsHide:true});
  run(prepare);
  await new Store(root).initialize();
  run(prefix+" if($item.GetAccessControl().GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $identity.User.Value){throw 'owner was not normalized to the user'}");
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

test('runtime dependency links and executable modes are preserved while adjacent run data stays private', async t => {
  const root=await fixture(t), directory=join(root,'.specship'), runtime=join(directory,'runtime');
  await mkdir(join(runtime,'node_modules'),{recursive:true});await mkdir(join(runtime,'vendor'));
  const executable=join(runtime,'vendor','tool');await writeFile(executable,'#!/bin/sh\necho fixture\n');await chmod(executable,0o755);const mode=(await lstat(executable)).mode;
  const dependency=join(runtime,'node_modules','linked-package');await symlink(join(runtime,'vendor'),dependency,process.platform==='win32'?'junction':'dir');
  await link(executable,join(runtime,'vendor','hardlinked-tool'));
  const config=join(directory,'config.json');await writeFile(config,'{"existing":true}');if(process.platform!=='win32')await chmod(config,0o644);
  const store=new Store(root);await store.initialize();const state=await store.create();await store.writePrivate(state.run_id,'adapter.json',{password:'fixture'});
  assert.equal((await lstat(executable)).mode,mode);assert.equal(await readFile(executable,'utf8'),'#!/bin/sh\necho fixture\n');assert.equal((await lstat(dependency)).isSymbolicLink(),true);assert.equal((await lstat(executable)).nlink,2);
  assert.equal(await readFile(config,'utf8'),'{"existing":true}');
  if(process.platform!=='win32'){assert.equal((await lstat(config)).mode&0o777,0o600);assert.equal((await lstat(join(store.runDir(state.run_id),'adapter.json'))).mode&0o777,0o600);}
});

test('a linked runtime root and links inside private runs still fail closed', async t => {
  const root=await fixture(t), directory=join(root,'.specship'), outside=join(root,'outside');await mkdir(directory);await mkdir(outside);
  const runtime=join(directory,'runtime');await symlink(outside,runtime,process.platform==='win32'?'junction':'dir');
  await assert.rejects(new Store(root).initialize(),/must not contain links/);await rm(runtime);
  const nested=join(directory,'runs','saved','runtime');await mkdir(dirname(nested),{recursive:true});await symlink(outside,nested,process.platform==='win32'?'junction':'dir');
  await assert.rejects(new Store(root).initialize(),/must not contain links/);
});
