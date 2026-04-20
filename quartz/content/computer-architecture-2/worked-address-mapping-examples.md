---
title: "Worked Address Mapping Examples"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 120", "Page 121"]
related: ["address-decomposition-into-tag-index-and-offset", "tag-index-and-valid-bit-in-direct-mapped-caches", "hits-misses-and-write-policies", "direct-mapped-cache-placement-rule"]
tags: ["offset", "word-offset", "byte-offset", "direct-mapped-cache", "tag", "memory-address"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-120-2.png", "/computer-architecture/assets/computer-architecture-2-page-121-2.png"]
---

## Worked Address Mapping Examples

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 120, Page 121

The notes provide several concrete examples showing how addresses are mapped into direct-mapped caches. One example splits a binary address into tag, index, and offset, then uses the index field to select cache slot 19 and compares the stored tag in that slot to the address tag; a match gives a hit, and a mismatch forces a memory fetch. A second example asks where byte address 1200 maps in a direct-mapped cache with 64 blocks and 1 word per block. Because each block holds 4 bytes, the memory block number is 1200 / 4 = 300, and the cache block is 300 mod 64 = 44. A third example uses 64 cache blocks and 16 bytes per block. Now the memory block number is 1200 / 16 = 75, and the cache block is 75 mod 64 = 11. The notes also state that offset equals word offset plus byte offset, with the byte offset always requiring 2 bits for 4-byte words.

### Source snapshots

![Computer Architecture-2 Page 120](/computer-architecture/assets/computer-architecture-2-page-120-2.png)

![Computer Architecture-2 Page 121](/computer-architecture/assets/computer-architecture-2-page-121-2.png)

### Page-grounded details

#### Page 120

V ex/ Imagine a data from memory address `0000111100011100010 | 0000010011 | 00`

[Diagram: the address is split into three bracketed/circled fields labeled underneath as `tag`, `index`, and `offset`. The last two bits `00` are the offset.]

↳ Last two bits (00) never consider

↳ index = `0000010011` = `19_dec`, therefore check cache slot with
index 19

↳ In slot 19, check the currently stored tag value and compare
to `0000111100011100010`

↳ If comparison is true, => hit, get data from cache

↳ If comparison is false => miss, get data from main memory


ex/ If a direct mapped cache has 64 blocks and each block stores
1 word (4 bytes), then how does the memory byte address
1200 map? (what cache block)

Solution: Converting the memory byte address to memory
block address yields

`1200`
`────` = `300`
` 4`

and modulo 64 yields

```
  300 | 64
  256
  ---
   44
```

[Diagram: address-format box labeled across bit positions `31 ... 8 7 ... 2 1 0`, with three fields from left to right: `Tag`, `Index`, `offset`. The `Index` field is between bit marks `7` and `2`, and `offset` spans bits `1` to `0`.]

#### Page 121

down Ex/ Cache has 64 cache blocks, stores 16 bytes per block (4 words)
to what cache block does memory address 1200 map?

down Solution:
1200|16
112 |75
0080

and modulo 64:

75|64
64|1
11

[Diagram: a rectangular address-field box divided into three labeled sections. Top labels over boundaries read `31`, `10 9`, `4 3`, `0`. Inside sections: `Tag` | `Index` | `offset`. Beneath sections: `22 bits`, `6 bits`, `4 bits`.]

down Also, its important to note that

offset = Word_offset + byte_offset
                             always 2

Where Word offset (block offset) answers which word
inside the block (since in this example we have 4 words
in a block)

-> Hits vs Misses Summary

- Read Hits
down what we want, direct data
read from the cache

- Write Hits
down Can write data into the cache
and memory (write through)
down Can write data only into the cache

- Read Misses
down 1. Stall the CPU
   2. fetch block from memory
   3. deliver to cache
   4. Resume the load (lw) instruction.

- Write Misses
down Can write the entire block into
the cache, then write to memory

down can just directly to memory.

### Key points

- Binary addresses are split into tag, index, and offset before lookup.
- The index selects the slot and the tag comparison decides hit or miss.
- For 64 blocks with 1 word per block, address 1200 maps through block number 300.
- In that case, 300 mod 64 = 44, so the cache block is 44.
- For 64 blocks with 16 bytes per block, address 1200 maps through block number 75.
- In that case, 75 mod 64 = 11, so the cache block is 11.
- Offset is composed of word offset plus byte offset.
- Byte offset is always 2 bits for 4-byte words.

### Related topics

- [[address-decomposition-into-tag-index-and-offset|Address Decomposition into Tag Index and Offset]]
- [[tag-index-and-valid-bit-in-direct-mapped-caches|Tag Index and Valid Bit in Direct Mapped Caches]]
- [[hits-misses-and-write-policies|Hits Misses and Write Policies]]
- [[direct-mapped-cache-placement-rule|Direct Mapped Cache Placement Rule]]

### Relationships

- example-of: [[direct-mapped-cache-placement-rule|Direct Mapped Cache Placement Rule]]
- example-of: [[address-decomposition-into-tag-index-and-offset|Address Decomposition into Tag Index and Offset]]
