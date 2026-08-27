function requireRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`Runtime V2 ${label} is invalid.`);
  }
  return value;
}

function requireSource(value, label) {
  if (typeof value !== "string") {
    throw new TypeError(`Runtime V2 ${label} source is invalid.`);
  }
  return value;
}

/**
 * Proves that ordinary development enters through hot Electron + Runtime V2
 * without requiring a standalone dashboard build. Lean mode remains an
 * explicit production-like path for later packaging and burn-in acceptance.
 * This is source evidence; a real hot Electron smoke remains mandatory.
 */
export function validateDevEntrypoints(input) {
  const candidate = requireRecord(input, "development entrypoint validation input");
  const rootPackage = requireRecord(candidate.rootPackage, "root package");
  const desktopPackage = requireRecord(candidate.desktopPackage, "desktop package");
  const rootScripts = requireRecord(rootPackage.scripts, "root package scripts");
  const desktopScripts = requireRecord(desktopPackage.scripts, "desktop package scripts");
  const leanSource = requireSource(candidate.leanLauncherSource, "lean launcher");
  const electronSource = requireSource(candidate.electronLauncherSource, "Electron launcher");
  const runtimePreparerSource = requireSource(
    candidate.runtimePreparerSource,
    "hot runtime preparer",
  );
  const errors = [];

  if (rootScripts.dev !== "npm run desktop:dev:hot") {
    errors.push("The primary npm run dev command does not select hot Electron Runtime V2.");
  }
  if (rootScripts["desktop:dev:lean"] !== "node desktop/scripts/dev-fast.mjs") {
    errors.push("desktop:dev:lean does not use the standalone dashboard launcher.");
  }
  if (rootScripts["desktop:dev:hot"] !== "npm --prefix desktop run dev") {
    errors.push("desktop:dev:hot is not the Electron hot-compiler path.");
  }
  if (rootScripts["desktop:dev:fast"] !== "npm run desktop:dev:lean") {
    errors.push("The compatibility fast alias does not resolve to lean mode.");
  }
  if (typeof rootScripts.dev === "string" && /dev-all|start-[A-Za-z0-9_-]+/u.test(rootScripts.dev)) {
    errors.push("The primary development command still launches a legacy process tree.");
  }

  if (
    desktopScripts.dev !==
    "npm run build && npm run prepare:native-runtime && node scripts/prepare-hot-dev-runtimes.mjs && npm run prepare:transcription && node scripts/sync-dev-runtime-manifests.mjs --stage-runtime-bins && node scripts/dev.mjs"
  ) {
    errors.push(
      "The desktop development command must prepare the native runtime, incrementally prove the hot non-bin runtime closure, prepare transcription tools, strictly stage the hot bin closure, then enter through Electron.",
    );
  }
  if (desktopScripts.predev !== "node scripts/sync-dev-runtime-manifests.mjs") {
    errors.push("Desktop development does not refresh the checked-in Runtime V2 manifests before launch.");
  }
  if (!/BREADBOARD_DESKTOP_DASHBOARD_MODE:\s*["']standalone["']/u.test(leanSource)) {
    errors.push("The lean launcher does not force standalone Runtime V2 mode.");
  }
  if (!/--breadboard-internal-lean-dashboard/u.test(leanSource)) {
    errors.push("The lean launcher does not pass the private explicit-lean marker.");
  }
  if (
    /spawn\s*\([^,]+,\s*\[[^\]]*\bnext\b[^\]]*["']dev["']/u.test(leanSource) ||
    /scripts\/dev-all/u.test(leanSource)
  ) {
    errors.push("The lean launcher can start a hot Next or legacy multi-service runtime.");
  }
  if (!/electronBinary[\s\S]*?["']--breadboard-dev["']/u.test(electronSource)) {
    errors.push("The desktop launcher does not start the real Electron application.");
  }
  if (
    !/--breadboard-internal-lean-dashboard/u.test(electronSource) ||
    !/dashboardMode\s*=\s*["']hot["']/u.test(electronSource) ||
    !/\.\.\.env[\s\S]*?BREADBOARD_DESKTOP_DASHBOARD_MODE:\s*dashboardMode/u.test(
      electronSource,
    )
  ) {
    errors.push(
      "The Electron hot entrypoint does not overwrite inherited dashboard mode after environment loading.",
    );
  }
  if (
    /scripts\/dev-all|start-[A-Za-z0-9_-]+\.mjs/u.test(electronSource) ||
    /spawn\s*\([^,]+,\s*\[[^\]]*\bnext\b[^\]]*["']dev["']/u.test(electronSource)
  ) {
    errors.push("The Electron launcher directly owns a legacy service or hot Next process.");
  }
  if (
    !/deriveHotRuntimeClosure/u.test(runtimePreparerSource) ||
    !/prepare-runtimes\.mjs/u.test(runtimePreparerSource) ||
    !/["']--only["']\s*,\s*target/u.test(runtimePreparerSource) ||
    !/metadata\.nlink\s*!==\s*1/u.test(runtimePreparerSource)
  ) {
    errors.push(
      "The hot runtime preparer is not manifest-derived, target-bounded, and hard-link-safe.",
    );
  }

  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}
