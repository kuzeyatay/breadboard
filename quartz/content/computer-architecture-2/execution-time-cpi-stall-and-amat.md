---
title: "Execution Time CPI Stall and AMAT"
date: "2026-04-19T16:59:21.587Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "slides-cac-15-18-memory-hierarchy"
source_file: "slides-CAC-15-18-memory_hierarchy.pptx"
locations: ["Slide 49", "Slide 51", "Slide 52"]
related: ["cache-memory-purpose-and-block-transfers", "hits-misses-and-write-policies", "block-size-trade-offs-and-spatial-locality", "cache-types-and-multi-level-organization"]
tags: ["cpi", "amat", "miss-penalty", "miss-rate", "hit-time", "execution-time"]
---

## Execution Time CPI Stall and AMAT

Source: [[slides-cac-15-18-memory-hierarchy|Memory Hierarchies and Cache Organization]]

Locations: Slide 49, Slide 51, Slide 52

The slides connect cache behavior to overall processor performance with explicit equations. Execution time is given as T_exec = N_instr x CPI x T_cycle. CPI itself is divided into ideal CPI and stall CPI, where cache misses contribute additional stall cycles. The stall term is expressed as CPI_stall = %reads x missrate_read x misspenalty_read + %writes x missrate_write x misspenalty_write. For a pipelined processor, the ideal CPI is stated as 1, so cache misses directly inflate CPI above the pipeline baseline. The slides also define Average Memory Access Time (AMAT) as hit time plus miss rate times miss penalty. They note that larger caches often have longer hit time, so an increased hit rate can be offset if hit latency grows too much. A worked example uses I-cache miss rate 6%, D-cache miss rate 4%, miss penalty 100 cycles, base CPI 4.0, and 50% load/store instructions; the resulting CPI is 12, making the ideal processor 3 times faster than the actual one under those miss conditions.

### Page-grounded details

#### Slide 49

The performance equation: Execution time T exec = N instr x CPI x T cycle where CPI = CPI ideal + CPI stall CPI stall = %reads x missrate read x misspenalty read + %writes x missrate write x misspenalty write CPI = average number of cycles per instruction For pipelined processor: CPI ideal = 1 Cache misses increase CPI by adding stall cycles! style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility

#### Slide 51

A direct mapped cache has the following metrics for a specific program execution: * D-cache miss rate = 4% * I-cache miss rate = 6% * Miss penalty = 100 cycles * Base CPI (ideal cache) = 4.0 Furthermore, Load & Store instructions are 50% of all instructions. D-cache miss occurs only during load/store instructions Calculate the actual CPI, then compute (and write down) how much faster is the ideal processor with 4.0 CPI. Cache Performance 55 Average missed cycles per instruction: * I-cache: 6%*100 = 0.06 x 100 = 6 cycles * D-cache: 50% * 4% *100 = 0.5 x 0.04 x 100 = 2 cycles Actual CPI = CPI_base + Miss_cycles per data fetch + Miss_cycles per instruction = 4.0 + 6 + 2 = 12 So, the ideal processor is 12 / 4.0 = 3 times faster style.visibility style.visibility style.visibility style.visibility style.visibility

#### Slide 52

Average Memory Access Time (AMAT) A larger cache will have a longer access time (hit time). An increase in hit time will likely add another cycle to the instruction. At some point, the increase in hit time for a larger cache will overcome the improvement in hit rate leading to a decrease in performance. Average Memory Access Time (AMAT) is the average to access memory considering both hits and misses AMAT = Time for a hit + Miss rate x Miss penalty

### Key points

- Execution time equals instruction count times CPI times cycle time.
- CPI = CPI_ideal + CPI_stall.
- Cache misses add stall cycles to CPI.
- AMAT = hit time + miss rate x miss penalty.
- A larger cache may increase hit time even while improving hit rate.
- In the worked example, cache misses raise CPI from 4.0 to 12.

### Related topics

- [[cache-memory-purpose-and-block-transfers|Cache Hits Misses and Block Transfers]]
- [[hits-misses-and-write-policies|Read Write Behavior on Hits and Misses]]
- [[block-size-trade-offs-and-spatial-locality|Block Size Tradeoffs]]
- [[cache-types-and-multi-level-organization|Cache Types and Multi-Level Organization]]

