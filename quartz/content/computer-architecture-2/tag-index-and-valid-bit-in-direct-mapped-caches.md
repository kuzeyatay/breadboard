---
title: "Tag Index and Valid Bit in Direct Mapped Caches"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 118"]
related: ["direct-mapped-cache-placement-rule", "address-decomposition-into-tag-index-and-offset", "worked-address-mapping-examples"]
tags: ["tag", "valid-bit", "direct-mapped-cache", "hit", "miss", "comparator"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-118-2.png"]
---

## Tag Index and Valid Bit in Direct Mapped Caches

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 118

Selecting a cache slot is not enough to determine whether the requested memory block is actually present there. Each cache entry must store metadata so the controller can distinguish the currently resident block from another block that maps to the same location. The notes identify three address-related fields: index, tag, and valid bit. The index selects the cache slot. The tag identifies which memory block is currently occupying that slot. The valid bit indicates whether the slot contains meaningful cached data at all; initially it is 0, and when a block is loaded it becomes 1. During lookup, the index points to one row, then if the valid bit is 1, the stored tag is compared with the tag bits of the requested address. A matching tag means a hit, while a mismatch means a miss because some competing block occupies that slot. The worked access table shows how repeated accesses update valid bits and tags over time.

### Source snapshots

![Computer Architecture-2 Page 118](/computer-architecture/assets/computer-architecture-2-page-118-2.png)

### Page-grounded details

#### Page 118

No. ____________

Date      /    /


But selecting the slot is not enough. The controller must still
know which memory block is currently in that slot. This is
why each cache entry stores not only data but also a tag and
a valid bit and an index, which is what forms the address
The index identifies the cache slot, the tag identifies which memory
block currently occupies that slot, and the valid bit says whether
the cache actually contains any valid data (Valid bit = 1 => present; = 0 => not present)
(initially 0).

If the valid bit is 1, the stored tag is compared to the tag bits
of the requested address. If they match, the access is a hit. If they
do not match, a competitor is sitting there, and the access is a
miss.

            tag        index
             up           up

| Memory | Binary | Hit/Miss | Cache block |
| Address | Address |          | (index)      |
|---------|--------|----------|--------------|
| 22      | 10110  | Miss     | 110          |
| 26      | 11010  | Miss     | 010          |
| 16      | 10000  | Miss     | 000          |
| 3       | 00011  | Miss     | 011          |
| 16      | 10000  | Hit      | 000          |
| 18      | 10010  | Miss     | 010

[Truncated for analysis]

### Key points

- A cache row stores data plus metadata used for lookup.
- The index identifies the cache slot to inspect.
- The tag identifies which memory block currently occupies that slot.
- The valid bit indicates whether the row contains valid cached data.
- Initially the valid bit is 0.
- If valid = 1 and the tag matches, the access is a hit.
- If the tag does not match, a competing block occupies the slot and the access is a miss.
- Access history changes the stored tag and valid state of a cache row.

### Related topics

- [[direct-mapped-cache-placement-rule|Direct Mapped Cache Placement Rule]]
- [[address-decomposition-into-tag-index-and-offset|Address Decomposition into Tag Index and Offset]]
- [[worked-address-mapping-examples|Worked Address Mapping Examples]]

### Relationships

- depends-on: [[address-decomposition-into-tag-index-and-offset|Address Decomposition into Tag Index and Offset]]

## Added from [[slides-cac-15-18-memory-hierarchy|Memory Hierarchies and Cache Organization]]

Source label: upload

Locations: Slide 13, Slide 14, Slide 15

Once a direct-mapped index identifies the only candidate cache slot, the cache still needs a way to know which memory block is currently stored there. The slides solve this by storing metadata with each cache entry: a valid bit, a tag, and the data itself. The low-order bits of the block address are used as the index, while the high-order bits become the tag. In the example, memory block address 12 is written as 01100; the lower bits 100 select the cache slot and the upper bits 01 form the tag. If the selected slot's valid bit is 1 and its tag matches the address tag, the access is a hit; otherwise it is a miss. The valid bit handles empty entries: initially all valid bits are 0, meaning no data is present. This decomposition is fundamental for both direct-mapped and associative caches, because it separates placement information from identity information.

### New key points

- Cache entries store metadata as well as data.
- The tag is formed from the high-order bits of the block address.
- The index is formed from low-order address bits and selects the candidate slot.
- A valid bit records whether a cache entry currently contains meaningful data.
- A hit requires both valid bit = 1 and tag match.
- Initially cache valid bits are 0, so all entries are empty.
