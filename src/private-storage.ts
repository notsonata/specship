import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, lstat, mkdir, readdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';

const execute = promisify(execFile);
const prepared = new Map<string, { ino: number; dev: number; promise: Promise<void> }>();

async function ownedEntry(path: string): Promise<Awaited<ReturnType<typeof lstat>>> {
  const entry = await lstat(path);
  if (entry.isSymbolicLink() || !entry.isDirectory() && (!entry.isFile() || entry.nlink !== 1)) {
    throw new Error(`Private storage must not contain links or special files: ${path}`);
  }
  if (process.platform !== 'win32' && entry.uid !== process.getuid!()) {
    throw new Error(`Private storage is owned by another user: ${path}`);
  }
  return entry;
}

export async function privateDirectory(path: string): Promise<void> {
  await mkdir(path, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  const entry = await ownedEntry(path);
  if (!entry.isDirectory()) throw new Error(`Private storage must be a directory: ${path}`);
  if (process.platform !== 'win32') await chmod(path, 0o700);
}

// Harden existing preview state as well as new storage. Same-account processes are trusted;
// these permissions protect against other ordinary local users, not the coding agent itself.
export async function preparePrivateStorage(workspace: string): Promise<void> {
  const root = join(await realpath(workspace), '.specship');
  await privateDirectory(root);
  const identity = await lstat(root);
  const cached = prepared.get(root);
  let preparation = cached?.ino === identity.ino && cached.dev === identity.dev ? cached.promise : undefined;
  if (!preparation) {
    preparation = (async () => {
      const paths: string[] = [];
      async function visit(path: string, runtime = false): Promise<void> {
        const entry = await ownedEntry(path);
        if (runtime && !entry.isDirectory()) throw new Error(`Runtime installation must be a real directory: ${path}`);
        paths.push(path);
        if (process.platform !== 'win32') await chmod(path, entry.isDirectory() ? 0o700 : 0o600);
        // Runtime code is trusted executable content, not private run data. Validate
        // its root but preserve dependency links, Git files, and executable modes.
        if (entry.isDirectory() && !runtime) for (const child of await readdir(path)) await visit(join(path, child), path === root && child.toLowerCase() === 'runtime');
      }
      await visit(root);
      if (process.platform === 'win32') {
        // Use native ACLs: chmod's POSIX mode bits do not restrict Windows readers.
        const script = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
# A PowerShell 7 parent can pass its module path to Windows PowerShell 5.1.
# Load this host's ACL cmdlets explicitly instead of autoloading an incompatible module.
Import-Module "$PSHOME\\Modules\\Microsoft.PowerShell.Security\\Microsoft.PowerShell.Security.psd1" -ErrorAction Stop
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$paths = [Console]::In.ReadToEnd() | ConvertFrom-Json
foreach ($path in $paths) {
  $acl = Get-Acl -LiteralPath $path
  if ($acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) { throw "Private storage is owned by another user: $path" }
}
foreach ($path in $paths) {
  $directory = Test-Path -LiteralPath $path -PathType Container
  if ($directory) { $acl = New-Object System.Security.AccessControl.DirectorySecurity; $inherit = [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit' }
  else { $acl = New-Object System.Security.AccessControl.FileSecurity; $inherit = [System.Security.AccessControl.InheritanceFlags]::None }
  $acl.SetOwner($sid)
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($identity in @($sid.Value, 'S-1-5-18', 'S-1-5-32-544')) {
    $principal = New-Object System.Security.Principal.SecurityIdentifier($identity)
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($principal, 'FullControl', $inherit, 'None', 'Allow')
    $acl.AddAccessRule($rule)
  }
  # Persist only the owner/DACL fields we changed; the provider's Set-Acl path
  # can request audit/security privileges when protecting existing state again.
  (Get-Item -LiteralPath $path -Force).SetAccessControl($acl)
}
`;
        const command = execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, maxBuffer: 1_000_000 });
        command.child.stdin!.end(JSON.stringify(paths));
        await command;
      }
    })();
    const entry = { ino: identity.ino, dev: identity.dev, promise: preparation };
    prepared.set(root, entry);
    preparation.catch(() => { if (prepared.get(root) === entry) prepared.delete(root); });
  }
  await preparation;
}
