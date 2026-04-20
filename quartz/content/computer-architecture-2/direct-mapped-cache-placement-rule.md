---
title: "Direct Mapped Cache Placement Rule"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 117"]
related: ["tag-index-and-valid-bit-in-direct-mapped-caches", "address-decomposition-into-tag-index-and-offset", "associative-mapping-design-space"]
tags: ["direct-mapped-cache", "modulo", "cache-slot", "evict", "hit", "miss"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-117-2.png"]
---

## Direct Mapped Cache Placement Rule

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 117

Direct mapping provides the simplest answer to the problem of where a requested block should be looked up in the cache. In a direct-mapped cache, every memory block has exactly one possible cache location. The location is determined by taking the memory block number modulo the number of cache locations. The notes give an example with an 8-location cache: memory block 12 must be stored in cache location 12 mod 8 = 4. Blocks 4, 12, 20, and 28 all map to the same cache location, so they compete for that single slot and can evict one another. This makes direct mapping easy to implement because the controller knows exactly where to inspect for any requested block, but it also makes the cache vulnerable to conflict misses when unrelated memory blocks repeatedly contend for the same position.

### Source snapshots

![Computer Architecture-2 Page 117](/computer-architecture/assets/computer-architecture-2-page-117-2.png)

### Page-grounded details

#### Page 117

Su Mo Tu We Th Fr Sa

No.
Date    /    /

√ The simplest answer to the first question is the direct-mapped cache...
where every memory block has exactly one possible place in the cache

√ ex/

[Diagram:
- A tall vertical rectangle on the left labeled `Memory` underneath.
- Memory slots are numbered down the left side:
  `31`
  `13`
  `12`
  `11`
  `10`
  `9`
  `8`
  `7`
  `6`
  `5`
  `4`
  `3`
  `2`
  `1`
  `0`
- A shorter vertical rectangle on the right labeled `cache` underneath.
- Cache slots are numbered down the left side:
  `7`
  `6`
  `5`
  `4`
  `3`
  `2`
  `1`
  `0`
- The memory block at `12` is outlined/highlighted.
- The cache block at `4` is outlined/highlighted.
- A curved arrow points from memory block `12` to cache location `4`.
]

√ If the cache has 8 locations, then memory block 12 must go
to location 12 mod 8 = 4. the same is true for blocks 4, 20
and 28: they all map to cache location 4. The memory blocks
are "fighting" for a single cache slot. Direct mapping is easy
because it makes lookup easy; for any requested block, there is
exactly one place to inspect. Its weakness is that many unrelated
blocks can be forced into the same location and evict one another.

### Key points

- In a direct-mapped cache, each memory block has exactly one cache location.
- The location is determined by modulo arithmetic.
- For an 8-line cache, block 12 maps to location 4 because 12 mod 8 = 4.
- Blocks 4, 12, 20, and 28 all compete for cache location 4.
- Lookup is easy because there is exactly one place to inspect.
- The main weakness is forced competition among unrelated blocks.

### Related topics

- [[tag-index-and-valid-bit-in-direct-mapped-caches|Tag Index and Valid Bit in Direct Mapped Caches]]
- [[address-decomposition-into-tag-index-and-offset|Address Decomposition into Tag Index and Offset]]
- [[associative-mapping-design-space|Associative Mapping Design Space]]

### Relationships

- depends-on: [[tag-index-and-valid-bit-in-direct-mapped-caches|Tag Index and Valid Bit in Direct Mapped Caches]]
- contrasts-with: [[associative-mapping-design-space|Associative Mapping Design Space]]

## Added from [[slides-cac-15-18-memory-hierarchy|Memory Hierarchies and Cache Organization]]

Source label: upload

Locations: Slide 7, Slide 9, Slide 10, Slide 11

The slides introduce direct mapping as the simplest cache placement policy. In a direct-mapped cache, each memory block can go to exactly one cache location. This makes lookup simple because the index is predetermined, but it creates contention because multiple memory blocks may compete for the same slot. The mapping rule is given explicitly: cache block number equals memory block address modulo the number of cache locations. A worked example uses 8 cache locations and 32 memory blocks, so each cache location can hold one of four possible memory blocks. Memory block 12 maps to cache block 4 because 12 modulo 8 equals 4, and blocks 4, 20, and 28 also compete for that same location. Memory block 11 maps to cache block 3. The slides describe this competition as memory blocks 'fighting' for a single cache location, highlighting the source of conflict misses in direct-mapped designs.

### New key points

- In direct mapping, each memory block has exactly one possible cache slot.
- Multiple memory blocks can map to the same cache location.
- The mapping rule is cache block number = memory block address modulo number of cache locations.
- With 8 cache locations and 32 memory blocks, each location corresponds to four possible memory blocks.
- Memory block 12 maps to cache block 4.
- Memory blocks 4, 12, 20, and 28 all contend for cache location 4.
