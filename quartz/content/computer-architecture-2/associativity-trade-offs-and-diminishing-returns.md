---
title: "Associativity Trade Offs and Diminishing Returns"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 126"]
related: ["associative-mapping-design-space", "average-memory-access-time", "block-size-trade-offs-and-spatial-locality"]
tags: ["associativity", "miss-rate", "comparator", "dirty-bit", "d-cache", "64-kb"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-126-2.png"]
---

## Associativity Trade Offs and Diminishing Returns

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 126

Although associativity reduces conflict misses, the notes emphasize that increasing associativity does not improve performance proportionally forever. A simulation result for a system with a 64 KB D-cache and 1-word blocks shows miss rate dropping from 10.3% for 1-way to 8.6% for 2-way, then only slightly to 8.3% for 4-way and 8.1% for 8-way. The annotation explicitly says this is not a good improvement relative to the increase in complexity. More ways mean more comparator hardware; for example, the notes mention that a 4-way associative cache needs 4 comparators. The page also references the dirty bit and gives a cache-size expression involving number of cache blocks, associativity, and block size. Overall, the lesson is that associativity is a trade-off between fewer conflict misses and greater hardware cost, energy use, and implementation complexity.

### Source snapshots

![Computer Architecture-2 Page 126](/computer-architecture/assets/computer-architecture-2-page-126-2.png)

### Page-grounded details

#### Page 126

- look at slides (last one) page66 - spectrum of associativity, and watch him
do the examples.

-> However, associativity also has diminishing returns  A simulation
of a system with 64 KB D-cache, 1-word blocks yields.

- 1-way, miss rate: 10.3%
- 2-way, miss rate: 8.6%
- 4-way, miss rate: 8.3%
- 8-way, miss rate: 8.1%

[Right-side bracket/annotation pointing to the associativity list:] not a good improvement for
increase in complexity

(4) need 4 comparators
for 4 way associative
cache

▹ dirty bit

! Cache size (bits) = N_cache_blocks x associativity(n) x block size

### Key points

- Higher associativity lowers miss rate mainly by reducing conflicts.
- The biggest gain in the example comes when moving from 1-way to 2-way.
- Further increases to 4-way and 8-way give only small extra reductions.
- Higher associativity requires more comparators.
- A 4-way associative cache needs 4 comparators.
- The added complexity may not justify the small miss-rate improvement.
- The notes also mention a dirty bit as part of cache metadata considerations.
- Cache size depends on number of blocks, associativity, and block size.

### Related topics

- [[associative-mapping-design-space|Associative Mapping Design Space]]
- [[average-memory-access-time|Average Memory Access Time]]
- [[block-size-trade-offs-and-spatial-locality|Block Size Trade Offs and Spatial Locality]]

### Relationships

- related: [[average-memory-access-time|Average Memory Access Time]]

## Added from [[slides-cac-15-18-memory-hierarchy|Memory Hierarchies and Cache Organization]]

Source label: upload

Locations: Slide 75

The slides make a practical design point about associativity: increasing associativity generally lowers miss rate, but the improvement diminishes as associativity becomes higher. A specific simulation result is shown for a 64KB data cache with 16-word blocks using SPEC2000 workloads. The miss rate drops from 10.3% for 1-way, to 8.6% for 2-way, to 8.3% for 4-way, and to 8.1% for 8-way. The largest gain comes when moving from direct mapped to 2-way, while later increases produce smaller improvements. This empirical pattern supports the earlier conceptual argument that associativity reduces conflict misses, but also suggests that very high associativity may not justify its complexity, area, power, or timing cost. The slides therefore frame associativity as a tunable design choice rather than a parameter that should simply be maximized.

### New key points

- Higher associativity tends to decrease miss rate.
- The reduction in miss rate becomes smaller as associativity increases further.
- The biggest gain in the example is from 1-way to 2-way.
- Later gains from 2-way to 4-way and 4-way to 8-way are modest.
- Associativity should be chosen as a design tradeoff, not maximized blindly.
