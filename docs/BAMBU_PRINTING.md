# Bambu Lab printing in Breadboard

Ask Breadboard to prepare a print. Hermes calls `bambu_print_prepare`, which returns a versioned native printer card attached to the active conversation, run and originating user turn. Choose a sliced file, select a printer and plate, map every filament, check the setup, then click **Approve & print** and confirm the physical setup. Language such as “print this” only prepares a draft.

## Setup

1. Run Breadboard through its supervised desktop runtime (`npm run dev` in `desktop`, with the repository's normal prerequisites). A bare `next dev` process does not own the printer daemon and fails closed at connection testing/approval.
2. Open **Settings → Connections → Bambu Lab → Set up**. Enter a name, private LAN IPv4 address, serial number and eight-character LAN access code. Explicitly select the model, installed nozzle and build plate. Configure each physically loaded filament source using stable AMS unit/tray identities or the external spool.
3. Confirm on the printer that its firmware permits third-party LAN commands. Enable LAN Only/Developer Mode where that firmware requires them. Breadboard never changes these modes, downgrades firmware or extracts application certificates. LAN Only removes cloud access such as Handy cloud control; requirements and available features depend on firmware. Read-only status access alone does not demonstrate start-command support.
4. Save, then **Test connection**. The form distinguishes configuration, reachability, authenticated status and start eligibility. Actual start support is marked verified only after an approved job is identified in telemetry. The test sends only an authenticated status request.
5. Optionally choose **Add printer photo** on the card. Images are decoded and re-encoded locally. No external image server or camera is required. A neutral fallback appears until a suitable photo is supplied, including when decoding/loading fails.

## Prepare a sliced file

In Bambu Studio, choose the exact printer/nozzle, build plate and filaments, place the model on a plate, and slice. Use the slicer's **Export plate sliced file** command (wording can vary) to export `.gcode.3mf`. An STL or ordinary project `.3mf` is not ready to print. Breadboard does not slice it.

Select a local file with the card's picker, choose a sliced attachment from this conversation, or ask the tool to use an authorized artifact/upload ID. Paths from tool arguments are not accepted. Archives must include Bambu Studio/OrcaSlicer machine instructions in `Metadata/plate_N.gcode`, explicit per-plate `filament_ids` metadata, printer profile, single nozzle diameter, build plate and filament material metadata. Missing safety-critical metadata blocks review with a re-export explanation; duration, material usage, colours and previews may be unavailable. Metadata checks cannot prove arbitrary machine instructions safe: use a file you trust.

The review shows slice requirements and configured values separately. Map each project filament index to its exact physical source. Same-material spools remain distinct. Colour substitutions/unverified colours require explicit acceptance. Then confirm the build plate is clear and correctly installed and the physical nozzle, filament and setup match. Breadboard has not visually checked these conditions.

## V1 supported protocol configurations

Configured single-nozzle **P1P, P1S, X1C, X1E, A1, A1 mini and H2S** are admitted by the adapter. Classic AMS indices 0–3, trays 0–3, are supported; A1/A1 mini admit one AMS Lite. An external spool supports only a one-filament plate. Nozzle sizes are explicit 0.2/0.4/0.6/0.8 mm. Supported plate types appear in the setup selector.

H2D/H2C and other multiple-nozzle paths, P2 models, AMS HT, more than four classic AMS units, cloud authentication and firmware requiring application certificates are unsupported. Unknown or contradictory reported model/nozzle configuration blocks dispatch. There is no tested firmware minimum or claim that every firmware on these models permits the reviewed protocol. H2S uses the separately audited H2 `project_file` mapping shape; **all model/firmware paths still require hardware verification**.

## Safety and recovery behavior

The existing SQLite database stores feature tables for printers, jobs, physical-printer locks and runtime leases. Jobs retain actual user/conversation/runtime/run/turn IDs and one canonical resource ID. They survive transcript restoration and do not inherit the assistant turn's completion. Credentials use the existing connected-app vault and are absent from tool results, resource JSON and telemetry. Saved network addresses and serials are backend-only.

Authenticated same-origin UI requests create a five-minute, single-use approval snapshot binding the owner, task, revision, file hash/size, selected plate and G-code hash, physical printer/configuration revision, source inventory, explicit mapping and options. Execution edits invalidate consent. No upload or start occurs before this transition. A physical-printer lock prevents parallel jobs or duplicate connection aliases. Fresh readiness and inventory are checked before upload and immediately before start.

The staged original container is immutable by interface and SHA-256 checked again at upload. Inspection never extracts archive paths or parses XML; archive/entry/expanded-size/count/time/image-dimension limits apply. Limits: 128 MiB container, 64 MiB per entry, 256 MiB expanded, 4,096 entries, 32 plates and a 10-second inspection deadline. FTPS acknowledgement plus remote `SIZE` verifies transfer length; **no remote checksum is claimed**. The local hash and selected G-code MD5 are sent according to the reviewed protocol.

A durable start intent is recorded before publishing. A timeout or crash after that point enters reconciliation and never automatically repeats the start. MQTT is nontransactional; this is not an exactly-once hardware guarantee. Only fresh non-retained telemetry identifying the unique filename (and task ID when supplied) confirms start, progress or completion. An idle printer or 100% progress alone does not complete a job. Unrelated jobs cannot receive this card's controls or supply its percentage.

Pause/resume/cancel require fresh matching identity and remain pending until telemetry confirms their outcome. Cancellation requires a separate confirmation. Draft cancellation sends no stop command. If identity cannot be reconciled, inspect the physical printer. Print details offers **Verify idle and close record** after explicit inspection and a fresh idle report; it records that the original outcome remains unknown. Printing again always creates a new draft and approval.

The authenticated loopback `bambu-printer` service is started on demand by the native supervisor. Its MQTT sessions, backoff and non-overlapping polling are independent of cards and model turns. Views share HTTP observers. Active jobs retain backend leases; unused connections are reaped and an idle service is released. Navigation/unmount never sends a stop. Restart preserves consumed approvals and reconciles without replay. Complete application shutdown stops monitoring; the printer may continue. Active connections cannot be reconfigured/disconnected, and job records do not cascade away when a task is deleted. Deleted tasks' unresolved jobs remain locked for reconciliation; they are not silently cancelled. Connections retains an owner-checked inspection/idle resolution action even when the original task is gone.

Known Bambu MCP configurations are rejected in the generic registry/configuration/invocation path. Hermes receives only the guarded preparation tool, with no heating, G-code, start or approval arguments. This is an application authorization boundary, not an operating-system sandbox against a privileged local user or arbitrary user-authorized shell code with independently obtained credentials.

## Runtime and packaging

The pinned source, local patch and licensing are described in `dashboard/third-party/bambu-printer-mcp/NOTICE.md`. No startup-time `npx`, global Node, slicer, camera, Docker or Unix shell is used. The Windows package copies the daemon, adapter, notices and complete exact-version MQTT/FTP dependency closures alongside the existing bundled Node runtime. Serial-specific connections use only configured private IPv4 endpoints (MQTT TLS 8883, implicit FTPS 990 and its negotiated passive data port restricted to the control host). The printer's self-signed LAN TLS follows the reviewed upstream mechanism; these credentials should be used on a trusted LAN.

## Verification and remaining gaps

Run focused engine/adapter tests with `node --experimental-strip-types --test tests/bambu-printing.test.mjs` and Electron integration with `node --experimental-strip-types --test tests/bambu-electron-ui.test.mjs` from `dashboard`. The latter uses actual normalized tool output, native renderer callsites, HTTP route handlers, vault, SQLite state machine and authenticated daemon, with isolated fixture auth/session/supervisor authorities and a deterministic fake physical adapter. It is simulated software integration, not a live printer test or a complete packaged-shell launch. It writes screenshots and a receipt under `dashboard/.tmp-bambu-qa` and never accesses the user's printer or database.

Type-check with `node --max-old-space-size=6144 node_modules/typescript/bin/tsc -p tsconfig.bambu.json --noEmit`; native environment tests use `cargo test -p breadboard-runtime-core service_environment --lib` from `native`. See `BAMBU_PRINTING_QA.md` for the commands actually run, results, screenshots and build limitations.

**Hardware verification: BLOCKED.** No printer connection/configuration or separate physical-print approval was supplied. Real LAN authentication, FTPS transfer, start acknowledgement, exact plate/mapping behavior, firmware compatibility, pause/resume/stop and physical completion have not been verified. A later hardware test must use the implemented trusted review/approval UI with the actual printer and a cleared, inspected build plate.
