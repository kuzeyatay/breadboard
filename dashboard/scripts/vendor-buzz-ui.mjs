// Vendors Buzz's shadcn-style UI primitives into the Buzz page.
//
// These files are generic (Radix + Tailwind + `cn`), so they port almost
// unchanged. What has to change is mechanical and is done here rather than by
// hand, so re-pulling from upstream stays a one-command job:
//
//   1. Buzz resolves `@/shared/...`; this app resolves `@/` to `src/`, and the
//      ported tree lives under `src/app/buzz/`.
//   2. Buzz is a Vite SPA where every module is client code. Next needs the
//      `"use client"` boundary spelled out.
//   3. Buzz's ThemeProvider is 750 lines of Tauri window plumbing. The
//      primitives only ever read `isDark` from it, so it is replaced by a
//      small local context of the same shape (`lib/theme.tsx`).

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const SRC = "../buzz/desktop/src";
const OUT = "src/app/buzz";

/** [source, destination] — destination is relative to OUT. */
const FILES = [
  ["shared/lib/cn.ts", "lib/cn.ts"],
  ["shared/lib/platform.ts", "lib/platform.ts"],
  ["shared/layout/auxiliaryPanelLayout.ts", "lib/auxiliaryPanelLayout.ts"],
  ["shared/hooks/use-mobile.tsx", "hooks/use-mobile.tsx"],
  ["shared/ui/popoverSurface.ts", "ui/popoverSurface.ts"],
  ["shared/ui/modalBackdrop.ts", "ui/modalBackdrop.ts"],
  ["shared/ui/smoothCorners.ts", "ui/smoothCorners.ts"],
  ["shared/ui/button.tsx", "ui/button.tsx"],
  ["shared/ui/input.tsx", "ui/input.tsx"],
  ["shared/ui/textarea.tsx", "ui/textarea.tsx"],
  ["shared/ui/avatar.tsx", "ui/avatar.tsx"],
  ["shared/ui/badge.tsx", "ui/badge.tsx"],
  ["shared/ui/separator.tsx", "ui/separator.tsx"],
  ["shared/ui/tooltip.tsx", "ui/tooltip.tsx"],
  ["shared/ui/dropdown-menu.tsx", "ui/dropdown-menu.tsx"],
  ["shared/ui/dialog.tsx", "ui/dialog.tsx"],
  ["shared/ui/popover.tsx", "ui/popover.tsx"],
  ["shared/ui/skeleton.tsx", "ui/skeleton.tsx"],
  ["shared/ui/card.tsx", "ui/card.tsx"],
  ["shared/ui/context-menu.tsx", "ui/context-menu.tsx"],
  ["shared/ui/sheet.tsx", "ui/sheet.tsx"],
  ["shared/ui/sidebar.tsx", "ui/sidebar.tsx"],
  ["shared/ui/spinner.tsx", "ui/spinner.tsx"],
  ["shared/ui/card-texture.css", "ui/card-texture.css"],
];

const ASSETS = [
  ["shared/ui/assets/card-texture.png", "ui/assets/card-texture.png"],
  ["shared/ui/assets/card-texture-dark.png", "ui/assets/card-texture-dark.png"],
  ["shared/ui/assets/card-texture-compact.png", "ui/assets/card-texture-compact.png"],
  [
    "shared/ui/assets/card-texture-dark-compact.png",
    "ui/assets/card-texture-dark-compact.png",
  ],
];

const IMPORT_REWRITES = [
  [/@\/shared\/theme\/ThemeProvider/g, "@/app/buzz/lib/theme"],
  [/@\/shared\/hooks\//g, "@/app/buzz/hooks/"],
  [/@\/shared\/lib\//g, "@/app/buzz/lib/"],
  [/@\/shared\/ui\//g, "@/app/buzz/ui/"],
  [/@\/shared\/layout\/AuxiliaryPanel/g, "@/app/buzz/lib/auxiliaryPanelLayout"],
  [/@\/shared\/layout\//g, "@/app/buzz/lib/"],
];

function port(source, destination) {
  let text = readFileSync(join(SRC, source), "utf8");
  for (const [pattern, replacement] of IMPORT_REWRITES) {
    text = text.replace(pattern, replacement);
  }
  if (/\.tsx?$/.test(destination) && !text.startsWith('"use client"')) {
    text = `"use client";\n\n${text}`;
  }
  const target = join(OUT, destination);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text, "utf8");
}

// Haptics are a Tauri command on the desktop app. In a browser there is
// nothing to call, and the sidebar reads better silently than it does throwing
// on every click, so the module is replaced rather than ported.
const HAPTICS_SHIM = `"use client";

// Buzz calls into a Tauri command for sidebar haptics. There is no such host
// here, so both entry points keep their signatures and do nothing.

export function performDefaultHaptic(): void {}

export function performSidebarDefaultHaptic(): void {}
`;

for (const [source, destination] of FILES) port(source, destination);

mkdirSync(join(OUT, "lib"), { recursive: true });
writeFileSync(join(OUT, "lib/haptics.ts"), HAPTICS_SHIM, "utf8");
for (const [source, destination] of ASSETS) {
  const target = join(OUT, destination);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(join(SRC, source), target);
}

console.log(`ported ${FILES.length} modules and ${ASSETS.length} assets into ${OUT}`);
