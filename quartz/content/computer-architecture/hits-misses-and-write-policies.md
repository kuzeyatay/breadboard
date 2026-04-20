---
title: "Hits Misses and Write Policies"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 121"]
related: ["cache-memory-purpose-and-block-transfers", "hit-ratio-miss-ratio-and-miss-penalty", "cache-performance-equations-with-cpi-stall"]
tags: ["read-hits", "write-hits", "read-misses", "write-misses", "write-through", "cpu-stall"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-121-2.png"]
---

## Hits Misses and Write Policies

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 121

The notes summarize cache behavior by separating read and write cases for both hits and misses. On a read hit, the needed data are simply read from the cache. On a write hit, two policy options are listed: the system may write into both cache and memory, which is write-through, or it may write only into the cache. On a read miss, the notes restate the standard refill sequence: stall the CPU, fetch the block from memory, deliver it to the cache, and resume the load instruction. On a write miss, the notes mention two broad possibilities: write the entire block into the cache and then write to memory, or bypass the cache and write directly to memory. These behaviors determine how misses affect performance and how cache state stays coherent with main memory. The discussion also supports the later formulas for CPI stall and AMAT because read and write misses can have different rates and penalties.

### Source snapshots

![Computer Architecture-2 Page 121](/computer-architecture/assets/computer-architecture-2-page-121-2.png)

### Page-grounded details

#### Page 121

down Ex/ Cache has 64 cache blocks, stores 16 bytes per block (4 words)
to what cache block does memory address 1200 map?

down Solution:
1200|16
112 |75
0080

and modulo 64:

75|64
64|1
11

[Diagram: a rectangular address-field box divided into three labeled sections. Top labels over boundaries read `31`, `10 9`, `4 3`, `0`. Inside sections: `Tag` | `Index` | `offset`. Beneath sections: `22 bits`, `6 bits`, `4 bits`.]

down Also, its important to note that

offset = Word_offset + byte_offset
                             always 2

Where Word offset (block offset) answers which word
inside the block (since in this example we have 4 words
in a block)

-> Hits vs Misses Summary

- Read Hits
down what we want, direct data
read from the cache

- Write Hits
down Can write data into the cache
and memory (write through)
down Can write data only into the cache

- Read Misses
down 1. Stall the CPU
   2. fetch block from memory
   3. deliver to cache
   4. Resume the load (lw) instruction.

- Write Misses
down Can write the entire block into
the cache, then write to memory

down can just directly to memory.

### Key points

- A read hit returns the requested data directly from cache.
- A write hit may update both cache and memory using write-through.
- A write hit may also update only the cache.
- A read miss stalls the CPU, fetches the block, fills cache, and resumes the load.
- A write miss can allocate the block in cache and then write to memory.
- A write miss can also bypass the cache and write directly to memory.
- Read and write misses may have different performance costs.

### Related topics

- [[cache-memory-purpose-and-block-transfers|Cache Memory Purpose and Block Transfers]]
- [[hit-ratio-miss-ratio-and-miss-penalty|Hit Ratio Miss Ratio and Miss Penalty]]
- [[cache-performance-equations-with-cpi-stall|Cache Performance Equations with CPI Stall]]

### Relationships

- related: [[hit-ratio-miss-ratio-and-miss-penalty|Hit Ratio Miss Ratio and Miss Penalty]]
- applies-to: [[cache-performance-equations-with-cpi-stall|Cache Performance Equations with CPI Stall]]

## Added from [[slides-cac-15-18-memory-hierarchy|Memory Hierarchies and Cache Organization]]

Source label: upload

Locations: Slide 47

The slides summarize what a cache does for both read and write requests under hit and miss conditions. A read hit is the desired case because data is delivered directly from cache. A read miss causes the CPU to stall, fetch the block from memory, deliver it to the cache, and then resume the load instruction. For writes, two major policies are listed on write hits: write-through, in which data is written to both cache and memory immediately, and write-back, in which data is written only to the cache and propagated to memory later. For write misses, the slides distinguish allocate-on-write-miss, where the entire block is brought into the cache before writing, from no-allocate-on-write-miss, where the cache line is not updated and the write goes directly to memory. These policy choices influence miss penalty, memory traffic, and the organization of cache metadata such as dirty bits in associative examples later in the slides.

### New key points

- A read hit supplies data directly from cache.
- A read miss stalls the CPU, fetches the block, updates the cache, and resumes the load.
- Write-through updates both cache and memory on a write hit.
- Write-back updates the cache now and memory later.
- Allocate-on-write-miss loads the whole block into cache before writing.
- No-allocate-on-write-miss writes to memory without updating the cache line.
