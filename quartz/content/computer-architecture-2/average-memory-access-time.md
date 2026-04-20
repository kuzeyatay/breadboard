---
title: "Average Memory Access Time"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 124"]
related: ["hit-ratio-miss-ratio-and-miss-penalty", "block-size-trade-offs-and-spatial-locality", "cache-performance-equations-with-cpi-stall"]
tags: ["amat", "hit-time", "miss-rate", "miss-penalty", "cache-performance"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-124-2.png"]
---

## Average Memory Access Time

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 124

The notes introduce hit time as the time required even when a cache access is successful, then use it to motivate AMAT, average memory access time. Hit time matters because design choices such as increasing block size can reduce miss rate while also increasing the time needed for a hit. AMAT combines these competing effects in a single expression: hit time plus miss rate times miss penalty. This formula prevents designers from optimizing only one part of cache behavior, such as miss rate, while ignoring the cost of a slower hit path. By combining hit time and miss-related delay, AMAT provides a more complete metric for memory-system evaluation than hit ratio alone. The notes place this concept right before associative caches, showing that structural changes in cache design should be evaluated not only for conflict reduction but also for their effect on access latency and hardware complexity.

### Source snapshots

![Computer Architecture-2 Page 124](/computer-architecture/assets/computer-architecture-2-page-124-2.png)

### Page-grounded details

#### Page 124

down Another performance concept is hit time : the time required even
when the access is a hit, which relates to changing the block
size since larger cache con reduce misses but increase hit time.
This is why designers use AMAT (average memory access time)

AMAT = hit time + miss rate x miss penalty

down Its important because it forces you to consider hits and misses together
rather than trying to optimize only one of them.

=> Associative Cache Mapping (Fully associative and n-way associative)
. Direct maping is one extreme of a larger design space. At the other
extreme is the fully associative cache. In a fully associative
cache, a memory block may be placed in any cache slot. That
greatly reduces forced overwriting because the controller is
free to place incoming blocks in any available space rather
than being forced into one predetermined location and only when the cache
is full, do you replace something.

down However, the price of this freedom is search cost If the
block could be anywhere, then on every access, the cache must
search all possible locations, which in order to accomplish this,
we need many comparators operating in parallel. (A comparator is
the hardware that ch

[Truncated for analysis]

### Key points

- Hit time is the time required even when the access is a hit.
- Design choices can reduce miss rate but increase hit time.
- AMAT stands for average memory access time.
- AMAT = hit time + miss rate x miss penalty.
- AMAT combines hit and miss behavior into one metric.
- It discourages optimizing only miss rate while ignoring hit cost.

### Related topics

- [[hit-ratio-miss-ratio-and-miss-penalty|Hit Ratio Miss Ratio and Miss Penalty]]
- [[block-size-trade-offs-and-spatial-locality|Block Size Trade Offs and Spatial Locality]]
- [[cache-performance-equations-with-cpi-stall|Cache Performance Equations with CPI Stall]]

### Relationships

- depends-on: [[hit-ratio-miss-ratio-and-miss-penalty|Hit Ratio Miss Ratio and Miss Penalty]]
- related: [[block-size-trade-offs-and-spatial-locality|Block Size Trade Offs and Spatial Locality]]
