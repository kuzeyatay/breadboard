---
title: "Hit Ratio Miss Ratio and Miss Penalty"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 115"]
related: ["cache-memory-purpose-and-block-transfers", "cache-performance-equations-with-cpi-stall", "average-memory-access-time"]
tags: ["hit-ratio", "miss-ratio", "miss-penalty", "hit", "miss", "cpu-stall"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-115-2.png"]
---

## Hit Ratio Miss Ratio and Miss Penalty

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 115

The notes formalize cache effectiveness using hit ratio, miss ratio, and miss penalty. Hit ratio is the number of hits divided by the number of accesses, while miss ratio is the number of misses divided by the number of accesses, or equivalently 1 minus the hit ratio. These ratios summarize how often the cache succeeds or fails in serving memory requests. The miss penalty is the time cost paid when a miss occurs. On a miss, the processor must stall, the missing block must be fetched from lower memory, the block must be inserted into the cache, and then the interrupted load instruction can resume. This sequence directly adds delay to execution and later feeds into CPI stall and AMAT calculations. The notes also point out an important conceptual nuance: although a miss is costly now, it may improve later accesses because the block has been brought into the faster level.

### Source snapshots

![Computer Architecture-2 Page 115](/computer-architecture/assets/computer-architecture-2-page-115-2.png)

### Page-grounded details

#### Page 115

- A Cache is a small, fast memory placed between the processor
and main memory. Its job is to answer a processor's request
before that request has to travel all the way down to
slower memory. The cache does not try to hold everything;
it tries to hold the things that are most likely to matter
next. If it is, the processor gets the data quickly. If not,
the control system must fetch the block from main memory,
place it into the cache, and then supply the needed data upward
(if the cache is full, it makes room by evicting a block)

The unit moved between levels is called a block (a line). A block may
contain one word or several words. If the
required block is already present in the cache,
the access is a hit (access satisfied by upper level)
If it's absent and must be fetched from the lower
level, the access is a miss (block copied from
slow level)

[Diagram at left: a small box labeled "Processor" with "Registers" written beside/under it; a vertical arrow points down to a rectangular grid labeled "cache"; another vertical arrow points down to a larger rectangular grid labeled "Main Memory".]

down The hit ratio is defined as:

hit ratio = hits
             number of accesses

wherea

[Truncated for analysis]

### Key points

- Hit ratio equals hits divided by total accesses.
- Miss ratio equals misses divided by total accesses.
- Miss ratio is also 1 minus hit ratio.
- Miss penalty is the time paid for a miss.
- A miss causes the CPU to stall.
- The missing block is fetched from memory and delivered into cache.
- After refill, the load instruction resumes.
- These quantities are later used in performance equations.

### Related topics

- [[cache-memory-purpose-and-block-transfers|Cache Memory Purpose and Block Transfers]]
- [[cache-performance-equations-with-cpi-stall|Cache Performance Equations with CPI Stall]]
- [[average-memory-access-time|Average Memory Access Time]]

### Relationships

- applies-to: [[cache-performance-equations-with-cpi-stall|Cache Performance Equations with CPI Stall]]
- applies-to: [[average-memory-access-time|Average Memory Access Time]]
