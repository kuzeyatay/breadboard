---
title: "Worked Direct-Mapped Cache Trace"
date: "2026-04-19T16:59:21.587Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "slides-cac-15-18-memory-hierarchy"
source_file: "slides-CAC-15-18-memory_hierarchy.pptx"
locations: ["Slide 16", "Slide 17", "Slide 18", "Slide 19", "Slide 21", "Slide 22", "Slide 24"]
related: ["direct-mapped-cache-placement-rule", "tag-index-and-valid-bit-in-direct-mapped-caches", "hits-misses-and-write-policies", "associativity-comparison-with-access-sequences"]
tags: ["direct-mapped-cache", "cache-example", "valid-bit", "tag", "hit", "miss"]
---

## Worked Direct-Mapped Cache Trace

Source: [[slides-cac-15-18-memory-hierarchy|Memory Hierarchies and Cache Organization]]

Locations: Slide 16, Slide 17, Slide 18, Slide 19, Slide 21, Slide 22, Slide 24

The slides provide a step-by-step trace of an 8-block, one-word-per-block direct-mapped cache starting from an empty state. The initial table marks every entry invalid. Accessing address 22, represented with tag 10 and index 110, causes a miss and fills index 110 with tag 10 and data Mem[10110]. Accessing address 26, with tag 11 and index 010, also misses and fills index 010. Later accesses show both compulsory and conflict behavior. Address 16, with tag 10 and index 000, misses the first time and becomes a hit on the second access because the same tag remains present and valid at index 000. Address 3, with tag 00 and index 011, misses and fills that slot. Address 18, with tag 10 and index 010, maps to the same index as address 26 but carries a different tag, so it causes a miss and replaces the earlier block at index 010. This trace concretely demonstrates how direct-mapped caches are checked and updated using index, valid bit, and tag.

### Page-grounded details

#### Slide 16

23 Cache Example Conditions: 8 cache blocks, 1 word per block, direct mapped Initial state Index V bit Tag Data 000 N 001 N 010 N 011 N 100 N 101 N 110 N 111 N

#### Slide 17

24 Cache Example Index V Tag Data 000 N 001 N 010 N 011 N 100 N 101 N 110 N 111 N Memory addr Binary addr Hit/miss Cache block 22 10 110 Miss 110 style.visibility style.visibility style.visibility style.visibility style.visibility

#### Slide 18

25 Cache Example Index V Tag Data 000 N 001 N 010 N 011 N 100 N 101 N 110 Y 10 Mem[10110] 111 N Memory addr Binary addr Hit/miss Cache block 22 10 110 Miss 110 style.visibility style.visibility style.visibility

#### Slide 19

26 Cache Example Index V Tag Data 000 N 001 N 010 Y 11 Mem[11010] 011 N 100 N 101 N 110 Y 10 Mem[10110] 111 N Memory addr Binary addr Hit/miss Cache block 26 11 010 Miss 010

### Key points

- An empty cache begins with all valid bits marked N.
- Address 22 with index 110 produces a miss and fills slot 110 with tag 10.
- Address 26 with index 010 produces a miss and fills slot 010 with tag 11.
- Address 16 with index 000 misses first and hits on a later repeat.
- Address 3 with index 011 causes another compulsory miss.
- Address 18 conflicts with the existing contents of index 010 and replaces it.

### Related topics

- [[direct-mapped-cache-placement-rule|Direct Mapped Cache Mapping Rule]]
- [[tag-index-and-valid-bit-in-direct-mapped-caches|Tags Index and Valid Bits in Cache Entries]]
- [[hits-misses-and-write-policies|Read Write Behavior on Hits and Misses]]
- [[associativity-comparison-with-access-sequences|Associativity Comparison with Access Sequences]]

