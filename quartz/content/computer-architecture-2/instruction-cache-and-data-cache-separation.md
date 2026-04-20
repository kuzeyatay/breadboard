---
title: "Instruction Cache and Data Cache Separation"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 123"]
related: ["cache-hierarchy-control-boundaries", "cache-performance-equations-with-cpi-stall", "hits-misses-and-write-policies"]
tags: ["i-cache", "d-cache", "instructions", "load", "store", "miss-rate"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-123-2.png"]
---

## Instruction Cache and Data Cache Separation

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 123

The notes state that cache memory is often split into an instruction cache and a data cache. The I-cache stores instructions, while the D-cache stores data. This separation exists because a processor frequently needs to fetch the next instruction while simultaneously reading or writing data for the current instruction. Splitting the cache allows both demands to be served more effectively and lets instruction and data references be analyzed with different miss rates. The performance example on the same page uses separate miss rates for the two structures, reinforcing that they behave differently in real workloads. The D-cache miss rate only affects load and store instructions, while the I-cache miss rate affects instruction fetches generally. This distinction is essential for realistic CPI analysis because not all instructions trigger data-cache accesses, but all executed instructions require instruction fetch.

### Source snapshots

![Computer Architecture-2 Page 123](/computer-architecture/assets/computer-architecture-2-page-123-2.png)

### Page-grounded details

#### Page 123

[Top-left printed mini table: `Su | Mo | Tu | We | Th | Fr | Sa`]

[Top-right printed header:]
No. __________
Date      /      /

√ The cache is also split into two parts: I-cache responsible for
storing instructions and a D-cache responsible for storing
data. This is done because a processor often wants to fetch the
next instruction while also reading or writing data for a current
instruction.

√ ex/ A direct mapped cache has the following metrics for a
specific program execution:

- D-cache miss rate = 4%

- I-cache miss rate = 6%

- Miss penalty = 100 cycles

- Base CPI (ideal cache) = 4

Furthermore load & store instructions are 50% of all
instructions. Calculate the actual CPI then compute (or write
down) how much "the ideal processor with 4.0 CPI is faster

down solution. (1) Compute Average missed cycle per instruction
   down I-cache: 6% * 100 = 0.06 x 100 = 6 cycles
   down D-cache: 50% * 4% x 100 = 0.5 x 0.04 x 100 = 2 cycles.
      ↘ D-cache miss only occurs in load/store instructions, so on
         50 percent of all instructions

down CPI = (CPI ideal + Miss cycles per data fetch + Miss cycles per instruction)
   = 4 + 6 + 2 = 12

down Therefore the ideal processor is

[Truncated for analysis]

### Key points

- The cache can be divided into I-cache and D-cache.
- I-cache stores instructions.
- D-cache stores data.
- The processor may fetch an instruction while also accessing data.
- I-cache and D-cache can have different miss rates.
- D-cache misses only matter for load and store instructions.
- Separate caches improve performance modeling and implementation.

### Related topics

- [[cache-hierarchy-control-boundaries|Cache Hierarchy Control Boundaries]]
- [[cache-performance-equations-with-cpi-stall|Cache Performance Equations with CPI Stall]]
- [[hits-misses-and-write-policies|Hits Misses and Write Policies]]

### Relationships

- applies-to: [[cache-performance-equations-with-cpi-stall|Cache Performance Equations with CPI Stall]]
