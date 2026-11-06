# Native circuit exporters

Weave's layout engine is vendored under `weave/` from the commit recorded in
`UPSTREAM.json`. Its README declares the author's code MIT; elkjs is EPL-2.0.
The only changes to the upstream engine expose typed circuit input, generic
symbol geometry, and connectivity inspection. `export.cjs` retains Breadboard's
pin order, model definitions, source fields and instance parameters. Inline
subcircuits stay in `models.lib`, and generated block symbols accompany the ASC.

`electronics-workbench-decoder` 0.2.0 (ISC) is installed from its pinned npm
release, corresponding to the cloned source commit. Its `encodeBuffer` and
`decodeBuffer` implement the MS14 container. The upstream multisim-mcp generator
(MIT, already under `vendor/multisim_mcp`) provides actual circuit XML.
Helper scripts copied from the same pinned clone live in `vendor/multisim_tools`.
NI component templates are generated under `.runtime/` from the user's licensed
installation, never included in the package or source repository.

Run `node scripts/setup-multisim-exports.mjs` from the Breadboard checkout to
install locked Node dependencies. Nothing is downloaded during an export.
Use `--multisim-python <32-bit python with pywin32>` to bootstrap local NI
templates; save and close Multisim first. The configuration is operator-owned
`.runtime/multisim-exports.json`. Installed Python packages can select a different
configuration with `BREADBOARD_CIRCUIT_EXPORT_CONFIG` and install the same lockfile
beside their packaged `export_runtime` directory.

If COM is unavailable, `--multisim-sample-shell` explicitly provisions templates
and the project shell from installed NI samples without opening Multisim. Such
exports report that native application compatibility has not been verified.
The bootstrap helper includes this opt-in adaptation. The isolated Python
adapter also resolves bounded constant arithmetic in subcircuit parameters so
the finite-bandwidth op-amp model expands to editable primitives correctly.

Exports are bounded, occur in a new temporary directory, and are published only
after validation. The artifact ZIP contains all companion files and a hash
manifest. Export does not claim the external application has opened the file or
run a simulation. Unsupported Multisim devices/models fail explicitly.
