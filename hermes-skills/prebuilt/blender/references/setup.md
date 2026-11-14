# Blender setup

Breadboard uses `ahujasid/mcp-for-blender` (MIT), PyPI package
`mcp-for-blender==2.2.9`. The server and add-on come from the same pinned package.
The Python dependency lock is `scripts/blender-requirements.txt`. Breadboard's
launcher disables upstream telemetry and connects only to `127.0.0.1:9876`.
No Blender Foundation affiliation is implied.

Install Blender separately and open it at least once. Install
[uv](https://docs.astral.sh/uv/getting-started/installation/), then from the
Breadboard checkout run:

```powershell
npm run setup:blender
```

When the desktop uses a separate data directory, target that same directory:

```powershell
npm run setup:blender -- --data-dir "C:\path\to\Breadboard\Data"
```

The installer prints the pinned `addon.py` location. In Blender's Preferences →
Add-ons, choose **Install from Disk**, select that file, and enable **MCP for
Blender**. In the 3D viewport press **N**, open **MCP for Blender**, and start its
server. Leave Blender open. In Breadboard select **Settings → Connections →
Blender → Connect**, then use `/blender` in Garden Chat or Terminal.

For an existing Blender user profile, `npm run setup:blender -- --install-addon`
can copy the pinned add-on into the detected Blender add-ons directory. Restart
Blender or disable/re-enable the add-on afterward. This option updates an
existing MCP for Blender add-on; the default setup only stages a copy.

Installed desktop builds ship the setup files under `app-services/scripts`:
run `node <app-services>/scripts/setup-blender.mjs --data-dir <Breadboard Data>`
with uv installed. Runtime files live in the writable data directory, never in
Program Files. The Settings panel reports the exact setup command and add-on
path for the current installation.

Use **Check connection** after opening Blender. An MCP discovery success alone
does not establish a working Blender connection. **Disable connection** stops
Breadboard's MCP process; Blender and the current project remain open.

Do not run upstream `setup` or `update`: those commands configure other AI
clients or replace the pinned version. Re-run Breadboard's installer to repair
its environment. Do not expose the add-on's socket on a public interface.
