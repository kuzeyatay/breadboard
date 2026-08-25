/**
 * Turbopack-only runtime bridge for the linked `mem0ai` package.
 *
 * `mem0ai` is a local `file:` dependency. Its package entry resolves through a
 * junction into the repository, so Turbopack no longer recognizes the request
 * as a `serverExternalPackages` dependency and tries to place every optional
 * native provider asset in ESM chunks. Keep the package request native at
 * runtime. The argument is a fixed internal module id, never user input.
 *
 * Webpack does not use this alias; the audited webpack external in
 * `next.config.ts` remains responsible for desktop standalone tracing.
 */

type Mem0OssModule = typeof import("mem0ai/oss");

const importRuntimeExternal = Function(
  "specifier",
  "return import(specifier)",
) as (specifier: string) => Promise<Mem0OssModule>;

const external = await importRuntimeExternal("mem0ai/oss");

export const Memory = external.Memory;
