# img-fx 0.5.1

The upstream fragment shader selects between 26 effects using a uniform. On
Windows ANGLE, compiling that entire shader stalled the renderer and could lose
the WebGL context. A plain WebGL/WebGL2 rendering probe succeeded on the same
machine; the image reveal stalled with both hardware and SwiftShader rendering.

The patch specializes the shader using a Three.js material define for the active
effect. Changing presets updates the define and invalidates the material, so
Three.js caches a program for each selected effect. The effect formulas, colors,
reveal animation and context-loss handling remain upstream implementations.
Both the ESM and CommonJS bundles are patched.

The DPR setter also accepts values down to 0.25. Breadboard uses 0.5 for the
pixel mosaic so full-width image cards can animate on software WebGL within
the reveal deadline. This only reduces the shader framebuffer; the separate
image-reveal canvas keeps its original display resolution.

`npm install` / `npm ci` apply the patch through `postinstall`. A failed patch
fails installation so an img-fx upgrade cannot silently restore the shader stall.
Recheck the patch when upgrading img-fx.
