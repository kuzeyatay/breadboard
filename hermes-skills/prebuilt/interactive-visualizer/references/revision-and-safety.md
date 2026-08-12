# Revision and safety

Lifecycle:

1. `planned`
2. `generating`
3. `validating`
4. `browser_testing`
5. `ready`, `failed`, or `cancelled`

Publication is atomic. Validation and browser checks operate on a candidate that
is not visible as the active version. A successful candidate becomes a normal
Breadboard artifact version. A failed revision remains evidence in the job
audit, while the active ready artifact and its preview stay unchanged.

Repair attempts are bounded to three per candidate sequence. Use returned error
details; do not broaden the design or repeatedly regenerate from scratch.

The preview iframe has a unique opaque origin and only `allow-scripts`.
Breadboard's response CSP disables network, forms, frames, workers, objects,
media, and external assets. Theme and resize messages use a versioned protocol,
a per-frame channel, and source validation.

Generated source has no ambient authority. The TypeScript AST must remain a
literal definition, HTML is a passive shell, and CSS cannot use URLs, imports,
executable expressions, or external resources. Three.js runs only inside the
trusted Breadboard runtime at the pinned local version.
