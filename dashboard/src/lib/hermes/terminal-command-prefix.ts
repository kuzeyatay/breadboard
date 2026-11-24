// Codex-style prefix rules for "always allow" on terminal commands
// (codex-rs/execpolicy, prompts/templates/permissions/approval_policy/on_request.md).
// Pure and dependency-free so the permission card can label its button with
// the exact prefix the server will store.

/** Shell features that make a command's effect differ from its prefix. */
const COMPOSITION = /[\r\n;&|<>`$%{}[\]()]|@\(/;

/**
 * Programs whose prefix would allow arbitrary code or removal. Codex bans the
 * same shapes ("python3", "python -", rm): approving them once must not
 * become standing permission for anything at all.
 */
const UNRULEABLE =
  /^(?:python\d*(?:\.exe)?|py(?:\.exe)?|node(?:\.exe)?|deno|bun|npx|ruby|perl|php|powershell(?:\.exe)?|pwsh(?:\.exe)?|cmd(?:\.exe)?|bash|sh|zsh|wsl(?:\.exe)?|Invoke-Expression|iex|Invoke-Command|icm|sudo|runas|env|Remove-Item|ri|rm|rmdir|rd|del|erase|Clear-Content|Set-Content|Format-Volume|format|diskpart|reg(?:\.exe)?|Set-ItemProperty|Stop-Computer|Restart-Computer|shutdown)$/i;

/** Launchers whose meaning is the program they start, so that is kept too. */
const LAUNCHER = /^(?:Start-Process|saps|start|&|\.)$/i;

const SUBCOMMAND = /^[a-z][\w.:-]*$/i;

export function commandTokens(command: string): string[] {
  const tokens: string[] = [];
  for (const match of command.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) {
    const value = match[1] ?? match[2] ?? match[3] ?? "";
    if (value) tokens.push(value);
  }
  return tokens;
}

/**
 * The reusable prefix "always allow" would store for this command, or null
 * when the command must keep asking every time. The program plus up to two
 * plain subcommand words: `winget install --id X` → `winget install`,
 * `npm run dev -- --port 3000` → `npm run dev`.
 */
export function commandRulePrefix(command: string): string[] | null {
  const value = command.trim();
  if (!value || COMPOSITION.test(value)) return null;
  const tokens = commandTokens(value);
  const [program, ...rest] = tokens;
  if (!program || UNRULEABLE.test(program) || UNRULEABLE.test(program.split(/[\\/]/).pop() ?? "")) {
    return null;
  }
  if (LAUNCHER.test(program)) {
    const target = rest[0];
    if (!target || /^[-/]/.test(target)) return null;
    const leaf = target.split(/[\\/]/).pop() ?? "";
    if (UNRULEABLE.test(target) || UNRULEABLE.test(leaf)) return null;
    return [program, target];
  }
  const prefix = [program];
  for (const token of rest.slice(0, 2)) {
    if (!SUBCOMMAND.test(token)) break;
    prefix.push(token);
  }
  // A bare tool name with arguments ("git -C x push") would allow the whole
  // tool. Only a specific program file (an installer path) stands alone.
  if (prefix.length === 1 && rest.length > 0 && !/[\\/]|\.(?:exe|msi|bat|cmd)$/i.test(program)) {
    return null;
  }
  return prefix;
}

/** True when `command` starts with every token of `prefix` (case-insensitive). */
export function commandMatchesPrefix(command: string, prefix: readonly string[]): boolean {
  const value = command.trim();
  if (!value || prefix.length === 0 || COMPOSITION.test(value)) return false;
  const tokens = commandTokens(value);
  if (!tokens[0] || UNRULEABLE.test(tokens[0])) return false;
  return prefix.every(
    (token, index) => tokens[index]?.toLowerCase() === token.toLowerCase(),
  );
}
