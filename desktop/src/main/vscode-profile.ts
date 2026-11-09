import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser";
import { assertVSCodeStorage, type VSCodeInstallation, type VSCodeStorage } from "./vscode-installation";

export interface VSCodeProfile {
  portable: string;
  settings: string;
  args: string[];
  themes: { light: string; dark: string };
}

/** Edit the hosted appearance settings, preserving JSONC and unrelated user edits. */
export function withVSCodeTheme(source: string, theme: "light" | "dark", themes = { light: "Light Modern", dark: "Dark Modern" }): string {
  const errors: ParseError[] = [];
  const value: unknown = parse(source, errors, { allowTrailingComma: true, allowEmptyContent: true });
  if (errors.length || value !== undefined && (!value || typeof value !== "object" || Array.isArray(value))) {
    throw new Error("The Code profile settings contain invalid JSON. Correct settings.json in VS Code to resume theme synchronization.");
  }
  const settings = value as Record<string, unknown> | undefined;
  const preferred = settings?.[theme === "light" ? "workbench.preferredLightColorTheme" : "workbench.preferredDarkColorTheme"];
  const colorTheme = typeof preferred === "string" && preferred.trim() ? preferred : themes[theme];
  let result = source;
  // Native title bars omit VS Code's custom top-left app icon. The docking
  // helper removes the native frame while hosted and restores it on release.
  // Native menus only run commands in a window Electron considers focused, and
  // a docked child window never is, so Terminal/View/Run did nothing: the
  // custom (HTML) menu bar runs commands inside the workbench instead.
  for (const [key, next] of Object.entries({ "workbench.colorTheme": colorTheme, "window.autoDetectColorScheme": false, "window.titleBarStyle": "native", "window.menuStyle": "custom" })) {
    if (settings?.[key] === next) continue;
    result = applyEdits(result, modify(result, [key], next, { formattingOptions: { insertSpaces: true, tabSize: 2, eol: source.includes("\r\n") ? "\r\n" : "\n" } }));
  }
  return result;
}

export function synchronizeVSCodeTheme(settings: string, theme: "light" | "dark", themes?: VSCodeProfile["themes"]): void {
  const source = fs.existsSync(settings) ? fs.readFileSync(settings, "utf8") : "{}\n";
  const next = withVSCodeTheme(source, theme, themes);
  if (next !== source || !fs.existsSync(settings)) fs.writeFileSync(settings, next, "utf8");
}

function installedThemes(executable: string): VSCodeProfile["themes"] {
  const directory = path.dirname(executable);
  // Recent Windows builds keep resources under a version/commit subdirectory.
  const bases = [directory, ...fs.readdirSync(directory, { withFileTypes: true }).filter(entry => entry.isDirectory() && /^[a-f0-9.]+$/i.test(entry.name)).map(entry => path.join(directory, entry.name))];
  for (const base of bases) {
    try {
      const contribution = JSON.parse(fs.readFileSync(path.join(base, "resources/app/extensions/theme-defaults/package.json"), "utf8"));
      const ids = new Set((contribution.contributes.themes as { id: string }[]).map(theme => theme.id));
      return { light: ids.has("Light Modern") ? "Light Modern" : ids.has("Default Light Modern") ? "Default Light Modern" : "Default Light+",
        dark: ids.has("Dark Modern") ? "Dark Modern" : ids.has("Default Dark Modern") ? "Default Dark Modern" : "Default Dark+" };
    } catch { /* Check the next supported installation layout. */ }
  }
  return { light: "Light Modern", dark: "Dark Modern" };
}

/**
 * Reuse the installed executable and extensions with a Breadboard-owned user
 * data directory. This lets theme changes survive opening another folder and
 * leaves unrelated standalone VS Code windows' settings alone.
 */
export function prepareVSCodeProfile(storage: VSCodeStorage, installation: VSCodeInstallation, theme: "light" | "dark", env: NodeJS.ProcessEnv = process.env): VSCodeProfile {
  assertVSCodeStorage(storage);
  const insiders = /insiders/i.test(path.basename(installation.executable));
  const profileName = `${installation.kind}-${insiders ? "insiders" : "stable"}`;
  const portable = path.join(storage.stateRoot, "profiles", profileName);
  const userData = path.join(portable, "user-data");
  const user = path.join(userData, "User");
  fs.mkdirSync(user, { recursive: true });
  const originalPortable = path.join(path.dirname(installation.executable), "data");
  const hasPortableData = fs.existsSync(originalPortable);
  const originalUser = hasPortableData ? path.join(originalPortable, "user-data", "User") :
    env.APPDATA ? path.join(env.APPDATA, insiders ? "Code - Insiders" : "Code", "User") : undefined;
  // Seed preferences once; never copy credentials, databases, or live session
  // state, and never overwrite later changes made in the Code tab.
  if (originalUser && installation.kind === "installed") {
    for (const name of ["settings.json", "keybindings.json"]) {
      const source = path.join(originalUser, name), target = path.join(user, name);
      if (fs.existsSync(source) && !fs.existsSync(target)) fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
    }
  }
  const originalExtensions = hasPortableData ? path.join(originalPortable, "extensions") :
    path.join(env.USERPROFILE || os.homedir(), insiders ? ".vscode-insiders" : ".vscode", "extensions");
  const extensions = installation.kind === "installed" && fs.existsSync(originalExtensions) ? originalExtensions : path.join(storage.payloadRoot, "profiles", profileName, "extensions");
  fs.mkdirSync(extensions, { recursive: true });
  const settings = path.join(user, "settings.json");
  const themes = installedThemes(installation.executable);
  synchronizeVSCodeTheme(settings, theme, themes);
  // ZIP/portable builds honor VSCODE_PORTABLE before --user-data-dir. Installed
  // User/System builds ignore that variable and use the explicit CLI directory.
  return { portable, settings, themes, args: ["--user-data-dir", userData, "--extensions-dir", extensions] };
}
