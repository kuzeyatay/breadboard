# Security

Generated input is hostile. Never ask Breadboard to relax validation or CSP.
Do not put secrets, prompts, conversation history, capability tokens, runtime
URLs, internal paths, provider configuration, or unrestricted source context in
the package.

Schema-2 JavaScript may use the local DOM, SVG, Canvas, animation frames,
ResizeObserver, input events, and the supplied `THREE` global. It may not use
network access, external URLs, navigation, storage, eval, dynamic import,
WebAssembly, workers, device capabilities, forms, nested frames, prototype
access, arbitrary host messaging, or external packages.

The published iframe has an opaque origin and `allow-scripts` only. The trusted
runtime uses a fixed, versioned, per-frame channel for ready, resize, and theme
messages. Generated code cannot use that channel.
