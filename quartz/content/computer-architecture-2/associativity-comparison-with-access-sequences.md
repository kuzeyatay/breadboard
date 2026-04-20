---
title: "Associativity Comparison with Access Sequences"
date: "2026-04-19T16:59:21.587Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "slides-cac-15-18-memory-hierarchy"
source_file: "slides-CAC-15-18-memory_hierarchy.pptx"
locations: ["Slide 61", "Slide 62", "Slide 68", "Slide 69", "Slide 74"]
related: ["associative-mapping-design-space", "direct-mapped-cache-placement-rule", "associativity-trade-offs-and-diminishing-returns", "worked-direct-mapped-cache-trace"]
tags: ["set-associative", "fully-associative", "direct-mapped-cache", "cache-example", "hit"]
---

## Associativity Comparison with Access Sequences

Source: [[slides-cac-15-18-memory-hierarchy|Memory Hierarchies and Cache Organization]]

Locations: Slide 61, Slide 62, Slide 68, Slide 69, Slide 74

The slides compare direct-mapped, 2-way set-associative, and fully associative caches using the same sequence of memory block accesses: 0, 8, 0, 6, 8, for a 4-block cache. In the direct-mapped case, block 0 and block 8 both map to index 0, so they repeatedly evict each other; every access in the sequence misses, including the second access to block 0. In the 2-way set-associative case, only 2 sets exist, each with 2 blocks. Blocks 0 and 8 both map to set 0, but because the set has two ways, both can coexist, so the second access to 0 becomes a hit. Later, block 6 also maps to set 0, causing replacement, and the final access to 8 misses. In the fully associative case, the blocks 0, 8, and 6 can all be present simultaneously in a 4-block cache, so the accesses to 0 and then 8 after the initial loads become hits. This sequence illustrates how associativity reduces conflict misses.

### Page-grounded details

#### Slide 61

64 Associativity Example Compare performance of 4-blocks cache Direct mapped, Vs. 2-way set associative, Vs. Fully associative Given the sequence of memory block access: 0, 8, 0, 6, 8 Direct mapped Block address Cache index Hit/miss Cache content after access Index 00 Index 01 Index 10 Index 11 0 - 00000 8 - 01000 6 - 00110 style.visibility style.visibility

#### Slide 62

65 Associativity Example Compare performance of 4-blocks cache Direct mapped, Vs. 2-way set associative, Vs. Fully associative Given the sequence of memory block access: 0, 8, 0, 6, 8 Direct mapped Block address Cache index Hit/miss Cache content after access Index 00 Index 01 Index 10 Index 11 0 0 miss Mem[0] 8 0 miss Mem[8] 0 0 miss Mem[0] 6 2 miss Mem[0] Mem[6] 8 0 miss Mem[8] Mem[6] 0 - 00000 8 - 01000 6 - 00110

#### Slide 68

70 Associativity Example 2-way set associative Only 2 sets for 4 blocks cache (each set contains 2 blocks) To address 2 sets, we need index of 1 bit Block address Cache index Hit/miss Cache content after access Set 0 Set 1 0 - 00000 8 - 01000 6 - 00110

#### Slide 69

71 Associativity Example 2-way set associative Only 2 sets for 4 blocks cache (each set contains 2 blocks) To address 2 sets, we need index of 1 bit Block address Cache index Hit/miss Cache content after access Set 0 Set 1 0 0 miss Mem[0] 8 0 miss Mem[0] Mem[8] 0 0 hit Mem[0] Mem[8] 6 0 miss Mem[0] Mem[6] 8 0 miss Mem[8] Mem[6] 0 - 00000 8 - 01000 6 - 00110

### Key points

- The comparison uses the access sequence 0, 8, 0, 6, 8.
- In a 4-block direct-mapped cache, every access in the sequence misses.
- In a 2-way set-associative cache, the second access to 0 becomes a hit.
- In the 2-way example, block 6 later forces a replacement within the same set.
- In a fully associative cache, both the second access to 0 and the final access to 8 hit.
- Higher associativity reduces conflict misses by allowing more flexible placement.

### Related topics

- [[associative-mapping-design-space|Associative and Set-Associative Cache Mapping]]
- [[direct-mapped-cache-placement-rule|Direct Mapped Cache Mapping Rule]]
- [[associativity-trade-offs-and-diminishing-returns|Associativity Benefits and Diminishing Returns]]
- [[worked-direct-mapped-cache-trace|Worked Direct-Mapped Cache Trace]]

### Relationships

- example-of: [[associativity-trade-offs-and-diminishing-returns|Associativity Benefits and Diminishing Returns]]
