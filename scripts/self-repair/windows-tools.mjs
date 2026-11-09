import fs from 'node:fs';
import path from 'node:path';

/** The native background environment intentionally has no general developer PATH. */
export function sourceRepairToolPath(env = process.env, platform = process.platform) {
  if (platform !== 'win32') return env.PATH;
  const system = env.SystemRoot ?? env.SYSTEMROOT;
  const programs = env.ProgramFiles ?? env.PROGRAMFILES ?? 'C:\\Program Files';
  if (!system || !path.isAbsolute(system) || !path.isAbsolute(programs)) throw Error('Trusted Windows repair tool roots are unavailable.');
  const files = [path.join(programs, 'Git/cmd/git.exe'), path.join(system, 'System32/WindowsPowerShell/v1.0/powershell.exe')];
  const normalized = value => path.resolve(value.replace(/^\\\\\?\\/, '')).toLowerCase();
  for (const file of files) {
    let valid = false;
    try { const stat = fs.lstatSync(file); valid = stat.isFile() && !stat.isSymbolicLink() && normalized(fs.realpathSync(file)) === normalized(file); } catch { /* fail closed below */ }
    if (!valid) throw Error('An installed Git or PowerShell executable is missing or linked; automatic repair cannot start.');
  }
  return [...files.map(file => path.dirname(file)), env.PATH ?? ''].filter(Boolean).join(path.delimiter);
}
