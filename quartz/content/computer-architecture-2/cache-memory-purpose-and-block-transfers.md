---
title: "Cache Memory Purpose and Block Transfers"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 115"]
related: ["hit-ratio-miss-ratio-and-miss-penalty", "cache-hierarchy-control-boundaries", "hits-misses-and-write-policies"]
tags: ["cache", "main-memory", "processor", "block", "line", "hit", "miss", "evicting"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-115-2.png"]
---

## Cache Memory Purpose and Block Transfers

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 115

A cache is a small, fast memory placed between the processor and main memory so that many processor requests can be answered without going all the way to slower memory. The cache does not attempt to store all of memory; instead, it stores the blocks most likely to be needed soon. Data move between hierarchy levels in units called blocks or lines, and a block may contain one word or multiple words. When the needed block is already present in the cache, the processor experiences a hit and the request is satisfied by the upper level. When the block is absent, the access is a miss, requiring the system to fetch the block from main memory, place it in the cache, and then forward the requested data to the processor. If the cache is full, an existing block must be evicted. The notes emphasize that a miss is not only a delay but also a preparation step for future accesses because the fetched block remains in cache after serving the current request.

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

- A cache sits between the processor and main memory.
- Its goal is to serve requests before they reach slower memory.
- The transfer unit between levels is a block, also called a line.
- A block may contain one word or several words.
- A hit means the required block is already in cache.
- A miss means the block must be fetched from a lower memory level.
- If the cache is full, a block is evicted to make room.
- A miss also prepares for future accesses because the block is stored in cache.

### Related topics

- [[hit-ratio-miss-ratio-and-miss-penalty|Hit Ratio Miss Ratio and Miss Penalty]]
- [[cache-hierarchy-control-boundaries|Cache Hierarchy Control Boundaries]]
- [[hits-misses-and-write-policies|Hits Misses and Write Policies]]

### Relationships

- measured-by: [[hit-ratio-miss-ratio-and-miss-penalty|Hit Ratio Miss Ratio and Miss Penalty]]
- part-of: [[cache-hierarchy-control-boundaries|Cache Hierarchy Control Boundaries]]

## Added from [[slides-cac-15-18-memory-hierarchy|Memory Hierarchies and Cache Organization]]

Source label: upload

Locations: Slide 3

A cache serves memory requests in fixed-size units called blocks or lines. When the processor reads data, the cache checks whether the required block is already present in the upper, faster level. If it is, the access is a hit and the request is satisfied immediately by the cache. If not, the access is a miss, and the block must be copied from the lower, slower level before the data is returned. The slides define hit ratio as hits divided by accesses and miss ratio as misses divided by accesses, with miss ratio equal to 1 minus hit ratio. They also define miss penalty as the time required to service a miss. These concepts are central because later performance equations compute the cost of cache misses in CPI and AMAT terms. The slides explicitly connect block transfer size, cache lookup, and demand fetch behavior: on a miss, data is first copied from memory into cache and then read from the cache by the processor.

### New key points

- A cache moves data in units called blocks or lines.
- A hit means the requested block is found in the upper level.
- A miss means the block is absent and must be copied from a lower level.
- Hit ratio equals hits divided by accesses.
- Miss ratio equals misses divided by accesses and also equals 1 - hit ratio.
- Miss penalty is the extra time spent to fetch the block from lower memory.
