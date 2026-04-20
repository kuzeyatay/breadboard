---
title: "Associative Cache Sizing Example with Dirty Bit"
date: "2026-04-19T16:59:21.587Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "slides-cac-15-18-memory-hierarchy"
source_file: "slides-CAC-15-18-memory_hierarchy.pptx"
locations: ["Slide 77"]
related: ["associative-mapping-design-space", "direct-mapped-cache-sizing-calculations", "hits-misses-and-write-policies"]
tags: ["set-associative", "dirty-bit", "valid-bit", "tag", "cache-size"]
---

## Associative Cache Sizing Example with Dirty Bit

Source: [[slides-cac-15-18-memory-hierarchy|Memory Hierarchies and Cache Organization]]

Locations: Slide 77

The slides also include a sizing example for a 2-way set-associative cache. In this example, the cache is indexed with a 6-bit index, has a 22-bit tag, and uses 34-bit byte-addressable memory. Each block contains a tag, a block of words, 1 dirty bit, and 1 valid bit, with each word being 4 bytes. The number of words per block is derived from the address decomposition: 34 total bits minus 22 tag bits, 6 index bits, and 2 byte-offset bits leaves 4 bits for block offset, which implies 2^4 = 16 words per cache data block. Since the cache is 2-way set associative, the total implemented size multiplies the number of sets, associativity, and per-block storage. The slides compute this as 2^6 x 2 x (32 x 16 + 22 + 1 + 1) = 68608 bits. This example generalizes the earlier direct-mapped sizing method to associative caches and explicitly includes dirty-bit overhead.

### Page-grounded details

#### Slide 77

33 Example on 2 way set-associative cache A data cache is indexed with a 6-bits index, tag size is 22 bits. Each cache block contains a tag, a block of words, 1 dirty bit, 1 valid bit; each word contains 4 bytes. The address size is 34 bits, and the memory is byte addressable. How many words are stored in one cache data block? Number of words in a cache-block = 2 (34 - 22 - 6 - 2) = 2 4 = 16 words The cache is 2 way set-associative. What is the total cache size (in bits)? Cache size (bits) = N_cache_blocks * associativity * block_size = 2 6 * 2 * (32*16 + 22 + 1 + 1) = 64 * 2 * 536 = 68.608 bits style.visibility style.visibility style.visibility style.visibility

### Key points

- The example cache uses 6-bit index and 22-bit tag fields.
- The memory address size is 34 bits and memory is byte addressable.
- Subtracting tag, index, and byte offset leaves 4 block-offset bits.
- A 4-bit block offset means 16 words per cache data block.
- Each cache block stores data, tag, 1 dirty bit, and 1 valid bit.
- The total cache size is computed as 68608 bits.

### Related topics

- [[associative-mapping-design-space|Associative and Set-Associative Cache Mapping]]
- [[direct-mapped-cache-sizing-calculations|Direct-Mapped Cache Sizing Calculations]]
- [[hits-misses-and-write-policies|Read Write Behavior on Hits and Misses]]

### Relationships

- depends-on: [[associative-mapping-design-space|Associative and Set-Associative Cache Mapping]]
