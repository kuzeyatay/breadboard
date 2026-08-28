# Breadboard memory tuning

Defaults are derived from detected physical memory and the current Windows
commit limit. Tune only from `qa/memory/latest-samples.ndjson` evidence; raising
a ceiling is not a repair for monotonic growth.

## Core environment settings

| Variable | Valid range | Purpose |
| --- | ---: | --- |
| `BREADBOARD_DASHBOARD_DEV_HEAP_MB` | 512–16384 MB | Hot dashboard V8 old-space only |
| `BREADBOARD_DASHBOARD_TREE_SOFT_LIMIT_MB` | 1024–24576 MB | Whole hot-dashboard descendant tree warning |
| `BREADBOARD_DASHBOARD_TREE_HARD_LIMIT_MB` | 1536–28672 MB | Whole-tree containment boundary |
| `BREADBOARD_MIN_FREE_COMMIT_MB` | 1024–32768 MB | Normal admission reserve |
| `BREADBOARD_CRITICAL_FREE_COMMIT_MB` | 512–16384 MB | Critical-pressure threshold |
| `BREADBOARD_MEMORY_SAMPLE_INTERVAL_MS` | 1000–300000 ms | Supervisor sampling interval |
| `BREADBOARD_MEMORY_TELEMETRY_INTERVAL_MS` | 1000–300000 ms | In-process dashboard sample interval; default 15000 ms |
| `BREADBOARD_MEMORY_TELEMETRY_SAMPLES` | 12–720 | Bounded in-process history; default 240 samples |
| `BREADBOARD_BACKGROUND_COORDINATOR_HEAP_MB` | 256–2048 MB | Scheduler/gateway child old-space; default 1024 MB |
| `BREADBOARD_INGEST_MAX_UPLOAD_MB` | 16–2048 MB | Streamed ingestion byte limit; default 512 MB |

| `BREADBOARD_MEMORY_QA_COLD_START_MB` | 512-16384 MB | Burn-in admission estimate; default 6144 MB |
| `BREADBOARD_MEMORY_QA_PROJECT` | `exploratory`, `critical`, or `hermes` | Burn-in workload; default `exploratory` |
| `BREADBOARD_LEAN_BUILD_ESTIMATE_MB` | 4096-16384 MB | Lean dashboard build admission estimate; default 11264 MB after measured Next 16 build peak |

Values must be plain whole numbers. Invalid input stops startup with the exact
key; it is never silently ignored. Memory ordering must be `heap < soft < hard`,
the critical reserve must be below the normal reserve, and dashboard hard plus
reserve must fit the detected commit limit.

On a roughly 32 GB physical / 41–42 GB commit machine, the starting policy is
approximately 6144 MB V8 old-space, 11264 MB tree soft, 13312 MB tree hard, an
8+ GB normal reserve, a 4+ GB critical threshold, and a 2+ GB emergency
threshold. Smaller machines scale down; larger machines do not receive an
unbounded heap.

The normal reserve is 20% of the detected commit limit (clamped to 1536-12288
MB), critical is 10% (768-6144 MB), and emergency is 5% (512-3072 MB).
Dashboard defaults use the smaller applicable physical-memory, usable-commit,
and absolute ceiling. The full formulas and ordering checks live in
`desktop/src/main/memory-policy.ts` and are covered by injected-snapshot tests.

Runtime V2 applies a separate native admission boundary. Packaged operation and
acceptance retain more than 8192 MB of free Windows commit. Lean and Hot
development use `max(4096 MB, clamp(10% of commit limit, 1536 MB, 8192 MB)) +
256 MB`, then add the requested worker or service's cold-start estimate. The
same development reserve is enforced after launch by the native supervisor's
live Job Object ceiling. Worker and non-dashboard service ceilings may only
tighten after launch; the dashboard is the sole profile allowed to expand as
system headroom returns and the sole tree sacrificed when the shared reserve is
crossed. Other trees still obey their manifest hard limits, but they do not all
terminate from the same global pressure sample. Finite workers still exit after
one job. Resource classes do not create a separate one-heavyweight-at-a-time
admission limit; overlapping bounded work is decided by live commit headroom.

## Postiz container limits

Defaults in MB are: Postiz 1536, Postiz PostgreSQL 512, Redis 256, Spotlight
256, Temporal Elasticsearch 768, Temporal PostgreSQL 512, Temporal 768,
Temporal admin tools 256, and Temporal UI 256. Override one with the normalized
service name, for example:

```powershell
$env:BREADBOARD_POSTIZ_POSTIZ_MEMORY_MB = '2048'
$env:BREADBOARD_POSTIZ_TEMPORAL_ELASTICSEARCH_MEMORY_MB = '1024'
```

Each value must be 128–8192 MB. The reservation is half the limit. If a
container hits its ceiling, diagnose that container; Docker does not
automatically restart it.

## Optional WSL example

Breadboard does not edit `%UserProfile%\.wslconfig`. A user who deliberately
wants a host-wide bound on a roughly 32 GB machine can consider:

```ini
[wsl2]
memory=8GB
swap=2GB

[experimental]
autoMemoryReclaim=gradual
```

Applying that optional global change requires:

```powershell
wsl --shutdown
```

This stops all WSL distributions, so do it only at a user-chosen safe time.
Breadboard's own admission and Compose limits remain active without it.

## Commands

```powershell
npm run dev                # normal integrated hot Electron + Runtime V2; no standalone prebuild
npm run desktop:dev:lean   # build and run the standalone dashboard
npm run desktop:dev:hot    # Next development server for active UI/API work
npm run qa:memory:smoke    # safe short GetPerformanceInfo baseline
npm run qa:memory:burn-in  # reserve-gated integrated QA
npm run qa:memory:dashboard -- --cycles=30                 # Turbopack rebuild receipt
npm run qa:memory:dashboard -- --bundler=both --cycles=30  # reserve-gated A/B receipt
npm run desktop:verify     # staged/package resource verification
```

`desktop:dev:hot` is intentionally the expensive option. Use it only while
editing dashboard UI/API code; ordinary desktop work and memory QA use lean
mode.

Lean mode never starts a hot compiler. If inputs changed but Windows cannot
safely admit a rebuild, it reuses the last complete, compatible standalone
artifact and says that recent source edits are not included. If no such
artifact exists, it fails with an actionable message. The explicit
`desktop:dev:lean:rebuild` command remains fail-closed. Rebuilds keep the last
complete artifact in a rollback slot until the replacement server, assets, and
manifest are all complete, so a reserve-triggered kill cannot destroy it.

The V8 heap setting is not a process limit. RSS/private bytes can be materially
higher because source maps, native allocations, `Buffer`/`ArrayBuffer` data,
mapped files, and compiler descendants are outside old-space. Use the dashboard
receipt for the in-process breakdown and `qa:memory:burn-in` for the complete
owned tree and Windows commit signal. The diagnostic endpoint is disabled
without a per-launch supervisor or benchmark token and keeps only a bounded
in-memory history.
