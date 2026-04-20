---
title: "Cache Block Size and Address Field Decomposition"
date: "2026-04-19T16:59:21.587Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "slides-cac-15-18-memory-hierarchy"
source_file: "slides-CAC-15-18-memory_hierarchy.pptx"
locations: ["Slide 26", "Slide 27", "Slide 28", "Slide 30", "Slide 31", "Slide 32", "Slide 33", "Slide 35"]
related: ["tag-index-and-valid-bit-in-direct-mapped-caches", "address-decomposition-into-tag-index-and-offset", "block-size-trade-offs-and-spatial-locality", "direct-mapped-cache-sizing-calculations", "direct-mapped-cache-sizing-calculations"]
tags: ["tag", "offset", "byte-offset", "word-offset", "block-size"]
---

## Cache Block Size and Address Field Decomposition

Source: [[slides-cac-15-18-memory-hierarchy|Memory Hierarchies and Cache Organization]]

Locations: Slide 26, Slide 27, Slide 28, Slide 30, Slide 31, Slide 32, Slide 33, Slide 35

The slides show how a memory address is divided into tag, index, and offset fields, and how this decomposition changes when block size changes. For a 32-bit address and a cache with 64 blocks storing one word per block, the address uses 2 bits for byte offset because each word is 4 bytes, 6 bits for index because 64 blocks require 2^6 entries, and the remaining 24 bits form the tag. A worked example maps byte address 1200 to the cache by first converting it to word address 300, then computing 300 modulo 64 = 44. When block size increases to 16 bytes or 4 words per block, the cache still needs 6 index bits for 64 blocks, but offset grows to 4 bits: 2 for byte offset and 2 for word offset within the block. The tag then shrinks to 22 bits. The slides generalize this by separating byte offset from block offset and explaining that larger blocks require more offset bits because each cache line contains more words.

### Page-grounded details

#### Slide 26

Real-World Cache Structure 32 This cache holds 1024 words, each word 4 bytes. a byte inside word is addressed by two lower bits of address index 0-1023 (2 10 ) - pointed from 10 middle bits in address The cache tag (20 bits) is compared against the upper portion of the address to determine whether the entry in the cache corresponds to the requested address. If the tag and upper 20 bits of the address are equal and the valid bit is 1 , then the request hits in the cache, and the word is supplied to the processor. Otherwise, a miss occurs. CPU requests data from 32 bit mem address: 000011110001110001010000010011 style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility

#### Slide 27

Real-World Cache Structure: Example 33 Imagine, a data from memory address 00001111000111000101 0 000010011 00 was requested by a program ( lw instruction) OK, index = 0000010011 bin = 19 dec , Check cache slot with index = 19 In slot 19 , check the currently stored t ag value and compare to 00001111000111000101 Comparison True?  hit, get data from cache False?  miss, get data from memory Last two bits (00) in the address we never consider - interested not in bytes but in words style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility

#### Slide 28

34 Example: Memory Block Size of One Word Cache has 64 cache blocks, stores 4 bytes per block (1 word) Exercise: To what cache block number does memory byte-address 1200 map? We already know: Cache block number = (Memory block address) modulo (#Blocks in cache) Memory block address = 1200 /4 bytes = 300 (word address) Cache block number = 300 modulo 64 = 44 , since 300 = (64*4) + 44 Tag Index Offset 0 1 2 7 8 31 2 bits 6 bits 24 bits style.visibility style.visibility style.visibility style.visibility style.visibility

#### Slide 30

36 Block sizes Tag Index Offset 0 1 2 7 8 31 2 bits 6 bits 24 bits 1 word Tag Index Offset 0 2 3 8 9 31 3 bits 6 bits 23 bits 1 word 1 word Block size - one word (4 bytes) Block size - 2 words (8 bytes) Tag Index Offset 0 3 4 9 10 31 4 bits 6 bits 22 bits 1 word Block size - 4 words (16 bytes) 1 word 1 word 1 word style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility

### Key points

- A cache address is partitioned into tag, index, and offset fields.
- Byte offset is 2 bits for 4-byte words.
- A 64-block cache needs 6 index bits.
- With one word per block, the remaining 24 bits of a 32-bit address form the tag.
- With four words per block, offset becomes 4 bits and tag becomes 22 bits.
- Memory byte address 1200 maps to cache block 44 in a 64-block, one-word-per-block cache.

### Related topics

- [[tag-index-and-valid-bit-in-direct-mapped-caches|Tags Index and Valid Bits in Cache Entries]]
- [[address-decomposition-into-tag-index-and-offset|Real-World Address Decomposition Example]]
- [[block-size-trade-offs-and-spatial-locality|Spatial Locality and Larger Block Example]]
- [[direct-mapped-cache-sizing-calculations|Direct-Mapped Cache Sizing Calculations]]

### Relationships

- example-of: [[address-decomposition-into-tag-index-and-offset|Real-World Address Decomposition Example]]
- applies-to: [[block-size-trade-offs-and-spatial-locality|Spatial Locality and Larger Block Example]]
- depends-on: [[direct-mapped-cache-sizing-calculations|Direct-Mapped Cache Sizing Calculations]]
