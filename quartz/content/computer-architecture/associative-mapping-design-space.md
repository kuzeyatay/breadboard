---
title: "Associative Mapping Design Space"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 124", "Page 125"]
related: ["direct-mapped-cache-placement-rule", "tag-index-and-valid-bit-in-direct-mapped-caches", "associativity-trade-offs-and-diminishing-returns"]
tags: ["fully-associative-cache", "set-associative-cache", "direct-mapping", "ways", "sets", "comparator", "block-address-modulo-number-of-sets"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-124-2.png", "/computer-architecture/assets/computer-architecture-2-page-125-2.png"]
---

## Associative Mapping Design Space

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 124, Page 125

The notes place direct mapping, fully associative mapping, and n-way set associativity on a design spectrum. Direct mapping is one extreme, where each memory block has exactly one destination. Fully associative caching is the opposite extreme: a memory block can be placed in any cache slot. This flexibility reduces forced overwriting and conflict, because the controller is free to put incoming blocks in any available location and only chooses something to replace when the cache is full. The cost is hardware complexity and search effort, since every access must potentially compare the requested tag with tags in all slots, requiring many comparators operating in parallel. Between these extremes lies n-way set associativity. The cache is divided into sets, each set contains n ways, and a block maps to exactly one set, usually by block address modulo number of sets, but within that set it may occupy any of the n slots. The notes explain that direct mapping is the 1-way case, while full associativity is equivalent to one giant set. A 2-way redesign example shows how competing blocks that once fought for one direct-mapped slot can now share two positions in the same set.

### Source snapshots

![Computer Architecture-2 Page 124](/computer-architecture/assets/computer-architecture-2-page-124-2.png)

![Computer Architecture-2 Page 125](/computer-architecture/assets/computer-architecture-2-page-125-2.png)

### Page-grounded details

#### Page 124

down Another performance concept is hit time : the time required even
when the access is a hit, which relates to changing the block
size since larger cache con reduce misses but increase hit time.
This is why designers use AMAT (average memory access time)

AMAT = hit time + miss rate x miss penalty

down Its important because it forces you to consider hits and misses together
rather than trying to optimize only one of them.

=> Associative Cache Mapping (Fully associative and n-way associative)
. Direct maping is one extreme of a larger design space. At the other
extreme is the fully associative cache. In a fully associative
cache, a memory block may be placed in any cache slot. That
greatly reduces forced overwriting because the controller is
free to place incoming blocks in any available space rather
than being forced into one predetermined location and only when the cache
is full, do you replace something.

down However, the price of this freedom is search cost If the
block could be anywhere, then on every access, the cache must
search all possible locations, which in order to accomplish this,
we need many comparators operating in parallel. (A comparator is
the hardware that ch

[Truncated for analysis]

#### Page 125

]But within that set it may be placed in any of the n ways so
direct mapping is just the 1-way case, and fully associative
is the extreme case where the whole cache behaves like one
giant set.

]The benefit is that conflict is reduced. In a direct cache, many
memory blocks ending with the same full index pattern all compete
for the same slot. In a 2 way set associative cache, those
competing blocks map to one set but now have two positions available
inside that set

|
next/

[table]
Index | V bit | Tag | Data
000   | Y     | 00  | Mem(#00000)
001   | N     |     |
010   | N     |     |
011   | N     |     |
100   | Y     | 00  | Mem(#00100)
101   | N     |     |
110   | N     |     |
111   | N     |     |

- 8 block direct mapped cache

downdown redesign

[diagram note: arrow from first table downward labeled "redesign"]

[table]
Index | V bit | Tag | Data || V bit | Tag | Data
00    | Y     | 000 | Mem(#00000) || Y | 001 | Mem(#00100)
01    | N     |     |             || N |     |
10    | N     |     |             || N |     |
11    | N     |     |             || N |     |

a set of
two blocks <-

- 2 way associative cache,
(4 set of 2 blocks.)

### Key points

- Direct mapping and fully associative mapping are two extremes of cache design.
- In a fully associative cache, a memory block may be placed in any cache slot.
- Fully associative placement reduces forced overwriting and conflict misses.
- Fully associative caches require searching all possible locations.
- This search needs many parallel comparators and consumes hardware resources and energy.
- In n-way set associativity, each block maps to one set but may occupy any of n ways.
- Set number is usually block address modulo number of sets.
- Direct mapping is 1-way set associativity, while full associativity is one giant set.

### Related topics

- [[direct-mapped-cache-placement-rule|Direct Mapped Cache Placement Rule]]
- [[tag-index-and-valid-bit-in-direct-mapped-caches|Tag Index and Valid Bit in Direct Mapped Caches]]
- [[associativity-trade-offs-and-diminishing-returns|Associativity Trade Offs and Diminishing Returns]]

### Relationships

- causes: [[associativity-trade-offs-and-diminishing-returns|Associativity Trade Offs and Diminishing Returns]]

## Added from [[slides-cac-15-18-memory-hierarchy|Memory Hierarchies and Cache Organization]]

Source label: upload

Locations: Slide 53, Slide 55, Slide 57, Slide 58, Slide 59, Slide 60, Slide 76

To reduce conflict misses caused by rigid direct mapping, the slides introduce more flexible placement strategies. In a fully associative cache, a memory block may be placed in any cache slot, which minimizes placement conflicts but requires searching all slots at once and is therefore expensive. As a compromise, an n-way set-associative cache divides the cache into sets, each containing n ways. A memory block maps to exactly one set using the index or block address modulo the number of sets, but within that set it may occupy any way. The slides illustrate how an 8-block direct-mapped cache can be reorganized into a 2-way set-associative cache with 4 sets of 2 blocks each, or into a 4-way cache with 2 sets of 4 blocks each. This reduces placement conflicts while keeping search cost manageable because only the tags in the selected set are compared in parallel. The spectrum therefore runs from 1-way direct mapped to fully associative.

### New key points

- Fully associative caches allow a block to be placed in any cache slot.
- Fully associative lookup requires searching all slots at once.
- n-way set-associative caches divide the cache into sets of n ways.
- A block maps to one set but may occupy any way within that set.
- Set index can be computed as block address modulo number of sets.
- Set associativity is a compromise between direct mapping and full associativity.
