---
title: "Address Decomposition into Tag Index and Offset"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 119"]
related: ["tag-index-and-valid-bit-in-direct-mapped-caches", "worked-address-mapping-examples", "direct-mapped-cache-placement-rule"]
tags: ["tag", "byte-offset", "32-bit-address", "comparator", "valid-bit", "decoder"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-119-2.png"]
---

## Address Decomposition into Tag Index and Offset

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 119

Direct-mapped cache lookup relies on splitting a memory address into fields that play different roles in cache access. The notes show a 32-bit address divided into tag, index, and byte offset. For a cache holding 1024 words where each word is 4 bytes, the lowest 2 bits identify the byte within the selected word, so they act as the byte offset and are not used to determine which word-level cache line is accessed. The next 10 bits form the index because 2^10 = 1024, giving one of 1024 cache rows. The remaining upper 20 bits form the tag. The hardware diagram shows the index selecting a row in the cache array, the stored tag from that row being compared with the address tag in a comparator, and the valid bit combining with the comparator output to assert the hit signal. The notes also remark that the index is not physically stored in each row because it is already represented by wires and decoder logic.

### Source snapshots

![Computer Architecture-2 Page 119](/computer-architecture/assets/computer-architecture-2-page-119-2.png)

### Page-grounded details

#### Page 119

The actual hardware implementation of the cache structure looks
like:

31 30...  ...13 12 11...210
[ Tag ][ Index ][ Byte
offset ]

20

10

[index line from address block down into table]

◊ The index itself is
  o not stored as a field
    in every row, it's already
    embodied by cache wires
    and decoder

            index   valid   tag   Data
            0
            1
            ...
            ...
            ...
            1021
            1022
            1023

20

32

Data

Hit

=

comparator

[Diagram description:
- A 32-bit address is split into `Tag`, `Index`, and `Byte offset`.
- The `Tag` field is labeled 20 bits.
- The `Index` field is labeled 10 bits and feeds down into the cache array as the row selector/index.
- The cache array is drawn as a table with columns `index`, `valid`, `tag`, and `Data`, and rows labeled `0`, `1`, `...`, `1021`, `1022`, `1023`.
- A note states that the index is not stored in each row because it is embodied by cache wires and decoder.
- The selected row's `valid`, `tag`, and `Data` are read out.
- The stored `tag` is compared with the address tag in a `comparator` drawn as `=`.
- The comparator result and valid bit feed a gate whose

[Truncated for analysis]

### Key points

- A 32-bit address is divided into tag, index, and byte offset.
- The lowest 2 bits select a byte within a 4-byte word.
- Those last 2 bits are ignored for word-level cache lookup.
- For 1024 words, the index is 10 bits because 2^10 = 1024.
- The remaining upper 20 bits form the tag.
- The index selects one cache row through decoder hardware.
- The stored tag is compared with the address tag to determine a hit.
- The valid bit and comparator output together generate the hit signal.

### Related topics

- [[tag-index-and-valid-bit-in-direct-mapped-caches|Tag Index and Valid Bit in Direct Mapped Caches]]
- [[worked-address-mapping-examples|Worked Address Mapping Examples]]
- [[direct-mapped-cache-placement-rule|Direct Mapped Cache Placement Rule]]

### Relationships

- applies-to: [[worked-address-mapping-examples|Worked Address Mapping Examples]]

## Added from [[slides-cac-15-18-memory-hierarchy|Memory Hierarchies and Cache Organization]]

Source label: upload

Locations: Slide 26, Slide 27

The slides extend the simplified direct-mapped examples to a more realistic cache organization. One example uses a cache holding 1024 words, where each word is 4 bytes. Because the memory is byte addressed, the two lowest bits of the address select the byte inside the word and are not used in the word lookup itself. The next 10 bits form the index because 1024 entries require 2^10 distinct values. The upper 20 bits become the tag and are compared against the tag stored in the indexed cache slot. A request hits only if the valid bit is 1 and the stored tag matches those upper 20 bits; otherwise it misses and must fetch from memory. A specific requested address is decomposed on the slides, with index bits equal to binary 0000010011, or decimal 19, so the processor checks slot 19 and compares its stored tag with 00001111000111000101. This example shows how abstract field decomposition is applied to an actual 32-bit address.

### New key points

- A 1024-word cache requires 10 index bits.
- The upper 20 bits of the 32-bit address form the tag in this example.
- The lowest 2 bits are byte offset and are ignored when selecting the word entry.
- The cache checks the indexed slot and compares the stored tag against the address tag.
- A valid bit must be set for a hit to occur.
- An example address maps to index 19.
