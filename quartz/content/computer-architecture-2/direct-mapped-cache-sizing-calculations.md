---
title: "Direct-Mapped Cache Sizing Calculations"
date: "2026-04-19T16:59:21.587Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "slides-cac-15-18-memory-hierarchy"
source_file: "slides-CAC-15-18-memory_hierarchy.pptx"
locations: ["Slide 43", "Slide 44", "Slide 46"]
related: ["cache-block-size-and-address-field-decomposition", "tag-index-and-valid-bit-in-direct-mapped-caches", "associative-cache-sizing-example-with-dirty-bit"]
tags: ["direct-mapped-cache", "tag", "byte-offset", "valid-bit", "cache-size"]
---

## Direct-Mapped Cache Sizing Calculations

Source: [[slides-cac-15-18-memory-hierarchy|Memory Hierarchies and Cache Organization]]

Locations: Slide 43, Slide 44, Slide 46

Several slides walk through how to compute index size, tag size, and total cache size for a direct-mapped cache. The example cache has a data capacity of 4096 bytes and a block size of 2 words, or 8 bytes, with byte-addressable 36-bit memory. The number of cache blocks is 4096 / 8 = 512, so the index must be 9 bits because 2^9 = 512. Since each block contains 2 words, the word offset is 1 bit, and because each word is 4 bytes, the byte offset is 2 bits. The tag therefore occupies the remaining 36 - 9 - 1 - 2 = 24 bits. To compute total implemented cache size, the slides multiply the number of blocks by the sum of data bits per block, tag bits, and valid bit: 512 x (32 x 2 + 24 + 1) = 45568 bits. This example emphasizes that physical cache size includes metadata overhead as well as payload data.

### Page-grounded details

#### Slide 43

33 Exam Example A direct mapped cache with capacity of 4096 bytes has a block size of 2 words, so 8 bytes. Cache has one valid bit. The memory is addressed with addresses of size 36 bits and is, as usual, byte addressable. a) How big is the cache index in bits ? N_cache_locations (blocks) = cache_size / block_size = 4096/8 bytes -> 512 locations or blocks. So, index =  2 log 512  = 9 bits (2 9 = 512). {5C22544A-7EE6-4342-B048-85BDC9FD1C3A} Valid bit Tag Memory block data 8 bytes (2 words) {5C22544A-7EE6-4342-B048-85BDC9FD1C3A} ......................... 4096 bytes, so 4096/8 = 512 cache slots 0 1 511 510 style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility

#### Slide 44

33 Example A direct mapped cache with capacity of 4096 bytes has a block size of 2 words, so 8 bytes. Cache has one valid bit. The memory is addressed with addresses of size 36 bits and is, as usual, byte addressable. How big is the cache index ? - Answer: 9 bits (previous slide) The address consists of 36 bits = tag + index + word_offset + byte_offset bits. word_offset = 1 bit (2 words / block), block_offset = 2 bits (4 bytes/word) -> tag = 36 - 9 - 1 - 2 = 24 bits. b) How big is the cache tag? Tag Index 2 bits 9 bits ? byte-offset 1 bit block-offset Total = 36 bits style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility

#### Slide 46

33 Example A direct mapped cache with capacity of 4096 bytes has a block size of 2 words, so 8 bytes. Cache has one valid bit. The memory is addressed with addresses of size 36 bits and is, as usual, byte addressable. How big is the cache index ? Answer: 9 bits c) How big , in number of bits, is the cache in total? So: cache size = N_cache_blocks * ( block_size + tag_size + valid bit) = 512 * (32*2 + 24 + 1) = 45568 bits . b) How big is the cache tag? Answer: 24 bits {5C22544A-7EE6-4342-B048-85BDC9FD1C3A} Valid bit Tag 24 bits Memory block data 8 bytes (2 words) {5C22544A-7EE6-4342-B048-85BDC9FD1C3A} ......................... 0 1 511 510 1 bit + 24 bits + 32*2 bits style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility

### Key points

- Number of cache blocks equals cache capacity divided by block size.
- A 4096-byte cache with 8-byte blocks has 512 cache blocks.
- A 512-block direct-mapped cache requires a 9-bit index.
- With 2 words per block, the word offset is 1 bit.
- With 4 bytes per word, the byte offset is 2 bits.
- The tag size is 24 bits and the total cache size is 45568 bits.

### Related topics

- [[cache-block-size-and-address-field-decomposition|Cache Block Size and Address Field Decomposition]]
- [[tag-index-and-valid-bit-in-direct-mapped-caches|Tags Index and Valid Bits in Cache Entries]]
- [[associative-cache-sizing-example-with-dirty-bit|Associative Cache Sizing Example with Dirty Bit]]

### Relationships

- contrasts-with: [[associative-cache-sizing-example-with-dirty-bit|Associative Cache Sizing Example with Dirty Bit]]
