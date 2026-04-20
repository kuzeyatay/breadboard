---
title: "Cache Types and Multi-Level Organization"
date: "2026-04-19T16:59:21.587Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "slides-cac-15-18-memory-hierarchy"
source_file: "slides-CAC-15-18-memory_hierarchy.pptx"
locations: ["Slide 50", "Slide 54", "Slide 51"]
related: ["memory-hierarchy-and-locality-principles", "execution-time-cpi-stall-and-amat", "associative-mapping-design-space"]
tags: ["i-cache", "d-cache", "instruction-cache", "data-cache"]
---

## Cache Types and Multi-Level Organization

Source: [[slides-cac-15-18-memory-hierarchy|Memory Hierarchies and Cache Organization]]

Locations: Slide 50, Slide 54, Slide 51

The slides distinguish instruction caches from data caches and show how splitting them can improve performance. An instruction cache (I-cache) stores instructions, while a data cache (D-cache) stores data operands. The slide diagram places both close to the CPU and labels them as L1 caches connected to instruction memory and data memory. Another slide recommends increasing performance by splitting instruction and data caches and by tuning them differently, suggesting that instruction and data streams have different access patterns and may benefit from different cache organizations. The same slide also shows a larger hierarchy with L1 and L2 caches and an I&D cache organization. This material places earlier discussions of hits, misses, and associativity into a broader system structure: there are multiple cache levels and potentially separate instruction and data paths. The distinction also matters for performance calculations, as later CPI examples treat I-cache and D-cache miss rates separately.

### Page-grounded details

#### Slide 50

Cache Types Instruction Cache (I-cache) - to store instructions Data Cache (D-cache) - to store data CPU I$ D$ Instruction Memory L1 Data Memory

#### Slide 51

A direct mapped cache has the following metrics for a specific program execution: * D-cache miss rate = 4% * I-cache miss rate = 6% * Miss penalty = 100 cycles * Base CPI (ideal cache) = 4.0 Furthermore, Load & Store instructions are 50% of all instructions. D-cache miss occurs only during load/store instructions Calculate the actual CPI, then compute (and write down) how much faster is the ideal processor with 4.0 CPI. Cache Performance 55 Average missed cycles per instruction: * I-cache: 6%*100 = 0.06 x 100 = 6 cycles * D-cache: 50% * 4% *100 = 0.5 x 0.04 x 100 = 2 cycles Actual CPI = CPI_base + Miss_cycles per data fetch + Miss_cycles per instruction = 4.0 + 6 + 2 = 12 So, the ideal processor is 12 / 4.0 = 3 times faster style.visibility style.visibility style.visibility style.visibility style.visibility

#### Slide 54

Increase performance Split - Instruction and Data caches Caches can be tuned differently CPU I$ D$ I&D $ Main Memory L1 L2 Use Associative mapping instead of Direct mapping

### Key points

- Instruction caches store instructions and data caches store data.
- I-cache and D-cache are shown as separate L1 caches near the CPU.
- Instruction and data caches can be tuned differently.
- The hierarchy may include both L1 and L2 caches.
- Separate I-cache and D-cache miss rates can be modeled independently in CPI calculations.

### Related topics

- [[memory-hierarchy-and-locality-principles|Memory Hierarchy Purpose and Structure]]
- [[execution-time-cpi-stall-and-amat|Execution Time CPI Stall and AMAT]]
- [[associative-mapping-design-space|Associative and Set-Associative Cache Mapping]]

### Relationships

- applies-to: [[execution-time-cpi-stall-and-amat|Execution Time CPI Stall and AMAT]]
