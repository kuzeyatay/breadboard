import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

export const LIVEKIT_RUNTIME_PACKAGES = ['@livekit/agents', '@livekit/rtc-node', '@livekit/local-inference'];

// Next's file trace can omit one side of dual CJS/ESM exports and dynamically
// loaded native bindings. Include the installed production closure, preserving
// nested versions instead of assuming every dependency is hoisted.
export function livekitRuntimePackagePaths(dashboardRoot, roots = LIVEKIT_RUNTIME_PACKAGES) {
  const modulesRoot = fs.realpathSync(path.join(dashboardRoot, 'node_modules'));
  const visited = new Set();
  function visit(name, parent, optional = false) {
    if (!/^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/i.test(name)) throw new Error(`Invalid runtime package: ${name}`);
    const require = createRequire(path.join(parent, 'package.json'));
    const root = require.resolve.paths(`${name}/package.json`)?.map(base => path.join(base, name))
      .find(candidate => fs.existsSync(path.join(candidate, 'package.json')));
    if (!root) {
      if (optional) return;
      throw new Error(`Missing LiveKit runtime dependency: ${name}`);
    }
    const relative = path.relative(modulesRoot, fs.realpathSync(root));
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`LiveKit dependency escapes dashboard node_modules: ${name}`);
    }
    if (visited.has(root)) return;
    visited.add(root);
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const optionalDependencies = manifest.optionalDependencies ?? {};
    for (const dependency of Object.keys(manifest.dependencies ?? {})) {
      visit(dependency, root, dependency in optionalDependencies);
    }
    for (const dependency of Object.keys(optionalDependencies)) visit(dependency, root, true);
    for (const dependency of Object.keys(manifest.peerDependencies ?? {})) {
      // @livekit/throws-transformer declares the TypeScript compiler as a
      // build-time peer. It is not needed by the compiled voice SDK. Breadboard
      // stages its compiler workers separately, after the route trace is checked.
      if (dependency === 'typescript') continue;
      visit(dependency, root, manifest.peerDependenciesMeta?.[dependency]?.optional === true);
    }
  }
  for (const root of roots) visit(root, dashboardRoot);
  return [...visited].map(root => path.relative(dashboardRoot, root).split(path.sep).join('/')).sort();
}

export function livekitRuntimeTraceIncludes(dashboardRoot) {
  return livekitRuntimePackagePaths(dashboardRoot).flatMap(root =>
    fs.readdirSync(path.join(dashboardRoot, root), { withFileTypes: true })
      // Nested packages have their own reviewed entries above. A package-wide
      // glob would also scoop up unused build/dev dependencies installed there.
      .filter(entry => entry.name !== 'node_modules')
      .map(entry => `${root}/${entry.name}${entry.isDirectory() ? '/**/*' : ''}`),
  ).sort();
}
