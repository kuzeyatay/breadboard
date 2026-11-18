/** Import-free so the per-turn registry can name the installer without loading it. */
export const MCP_INSTALLER_CONNECTION = "mcp-installer";

const c = JSON.stringify(MCP_INSTALLER_CONNECTION);

export const MCP_INSTALLER_CONTEXT = [
  `# programs_and_mcp_connections`,
  `When the user asks to do something in a desktop program or service (e.g. "run a contingency analysis in PowerWorld", "route this board in KiCad", "model a bracket in FreeCAD"), or asks to add/connect/install an MCP for one, work through these steps in order and keep going until the task is done:`,
  `1. Connection: if an installed MCP connection for that program is listed in this prompt, use it with mcp_call and skip to the task.`,
  `2. Program: mcp_call connection=${c} tool="find_app" args={name} checks whether the program is installed on this computer and lists winget packages for it. If it is missing and the MCP needs it, call tool="install_app" args={wingetId} with the exact Id from find_app. If no winget package exists (licensed or vendor-only software), tell the user where to get it and continue with the rest.`,
  `3. MCP: tool="search" args={query: the program's name} finds GitHub repositories; tool="inspect" args={repo} reads the best candidate's README and packaging; then tool="install" with repo=<owner/name>, name=<the program's short name, e.g. "KiCad"> and the launch the README documents. Prefer a published npm/PyPI package (launch "npx"/"uvx" with package; for uvx add command when the executable name differs from the package, e.g. package "pkg[extra]" command "pkg run x"), then "uvx" from git with the console-script name as command, then "clone" (optionally with ref) with the README's run command, or "remote" for a hosted URL. If a candidate fails to start, try the next one. Once installed, the connection's tools are usable immediately in this turn with mcp_call connection=<its name>, tool="__breadboard_list_tools" first, and in every later chat.`,
  `4. Last resort only: when no MCP that works with the program can be found, installed (including when the user declines it) or started, open the computer-use skill (skill_open "computer-use") and drive the program's own window to finish the task. Do not open computer-use for a program task before steps 1-3 have been tried.`,
  `Never ask for permission in chat before install or install_app: the call itself shows the user an approval prompt with the exact command when one is needed, and in YOLO mode it runs without one. Tell the user what you installed and anything still required (a license, environment variables, an add-on enabled inside the program).`,
].join("\n");
