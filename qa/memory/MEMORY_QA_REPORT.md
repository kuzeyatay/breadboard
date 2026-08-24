# Breadboard Memory QA Report

- Mode: smoke
- Workload project: sampler-only
- Outcome: ABORTED SAFELY
- Metric source: GetPerformanceInfo
- Samples: 3
- Initial free commit: 9523 MB
- Minimum free commit: 8325 MB
- Peak system commit: 33956 MB
- Peak QA-owned private bytes: 0 MB
- Final QA-owned private bytes: 0 MB
- Reserve: 8456 MB
- Workload exit code: not launched
- Reason: emergency reserve crossed at 8325 MB

Raw evidence is in `latest-samples.ndjson`; the machine-readable rollup is
in `latest-summary.json`. A safe abort is not a memory pass.
