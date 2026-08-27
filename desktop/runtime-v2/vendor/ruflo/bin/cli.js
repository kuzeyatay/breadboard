#!/usr/bin/env node

// Keep npm's installed package boundary intact so its bundled dependencies
// resolve exactly as published. Runtime V2 launches this fixed, shell-free
// wrapper instead of relying on a generated node_modules/.bin shim.
await import("../node_modules/@claude-flow/cli/bin/cli.js");
