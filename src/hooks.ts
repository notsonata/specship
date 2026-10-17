export function quotePosix(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function interruptCommand(
  nodeExecutable: string,
  cliPath: string,
  workspace: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform !== 'win32') {
    return [nodeExecutable, cliPath, 'interrupt', '--workspace', workspace].map(quotePosix).join(' ');
  }
  const literal = (value: string) => `'${value.replace(/'/g, "''")}'`;
  const script = `& ${literal(nodeExecutable)} ${literal(cliPath)} interrupt --workspace ${literal(workspace)}`;
  return `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(script, 'utf16le').toString('base64')}`;
}
