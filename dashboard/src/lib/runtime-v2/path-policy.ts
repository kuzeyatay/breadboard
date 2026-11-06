// Dashboard adapters and disposable workers must compare the same Windows
// spellings. Keep one implementation; callers still lstat and realpath before
// trusting a path, so lexical equivalence never authorizes a redirected file.
export { sameRuntimePath, runtimePathWithin } from "../../../scripts/runtime-v2-paths.mjs";
