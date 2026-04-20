---
title: "Memory hierarchy and locality principles"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 113", "Page 114"]
related: ["data-memory-interface-and-address-calculation", "single-cycle-multicycle-and-pipelined-execution"]
tags: ["memory-hierarchy", "sram", "dram", "cache", "temporal-locality", "spatial-locality", "volatile"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-113-2.png", "/computer-architecture/assets/computer-architecture-2-page-114-2.png"]
---

## Memory hierarchy and locality principles

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 113, Page 114

The final section introduces memory hierarchy as the architectural solution to the speed, cost, and size mismatch between processor logic and memory technologies. Registers are extremely fast but tiny; caches, often implemented with SRAM, are larger but still fast; main memory, commonly DRAM, is much larger but slower; and lower levels such as SSDs, disks, and tapes are even larger, slower, and nonvolatile. The notes explicitly state that the whole machine cannot simply be built from the fastest memory because faster technologies cost more per bit and consume more chip area. The hierarchy therefore arranges small, fast storage close to the processor and large, cheap storage farther away. The section also distinguishes volatile storage, which loses data without power, from nonvolatile storage, which retains data. The hierarchy works because programs exhibit locality: temporal locality means recently used items are likely to be reused soon, and spatial locality means nearby addresses tend to be used together. Examples include repeatedly using a loop variable and traversing arrays sequentially.

### Source snapshots

![Computer Architecture-2 Page 113](/computer-architecture/assets/computer-architecture-2-page-113-2.png)

![Computer Architecture-2 Page 114](/computer-architecture/assets/computer-architecture-2-page-114-2.png)

### Page-grounded details

#### Page 113

Week 7 [scribbled out] lecture 1/2

=> Optimizing Memory: Memory hierarchies and organizations

- The problem begins with an uncomfortable mismatch inside the computer. The processor wants to act at the speed of its own internal logic but accessing Main Memory takes so [unclear] much time. For comparison, registers can be used in roughly a nanosecond whereas main memory access might take thirty nanoseconds or more. (Main memory exists because data memory is not enough to keep alot of information so we have other types of memories). That means a single access can consume on the order of many Processor cycles.

down Why, then, not just build the whole machine out of the fastest memory? Because not to speed, costs and physical area matter just as much. For example SRAM (Static RAM) which is the fast memory technology used for caches (cache = [unclear]), is vastly more expensive per bit and takes much more chip area per bit stored, than DRAM (Dynamic RAM), which is the technology used for Main Memory. Therefore, the architecture is forced to have layered arrangements: very fast in very small near the Processor, then large and slower farther away. This is the Memory hierarchy.

[Diagram

[Truncated for analysis]

#### Page 114

Su  Mo  Tu  Wo  Th  Fr  Sa

No.
Date  /  /

√ At the top are registers, tiny and extremely fast. Below the-
are caches, still fast but larger than registers. Below caches,
sits main memory, usually DRAM, much larger but slower. Below
main memory sits persistent storage such as an SSD or a disk, vastly
larger and slower, but nonvolatile. The point of hierarchy is
not to create complexity for its own sake, but to get the
speed of the upper levels whenever possible while having the
capacity and low cost of the lower levels. When a computer
is not running a program, the program lives in nonvolatile
storage. When the program is launched, it is loaded into main
memory. When pieces of it are being used intensely, those move
closer, into cache and then into registers.

√ This strategy works because programs are not random in
how they use memory. They have habits, and those habits
are captured by the principle of locality

a) Temporal locality :- means that if an item was used recently,
its likely to be used again soon

down ex/ if a variable like i is used in every iteration of a loop
from 0 to 1000, it makes no sense to fetch it
from main memory every time as though it were a stranger
So

[Truncated for analysis]

### Key points

- Memory hierarchy addresses the mismatch between fast processors and slower memory.
- Registers are fastest and smallest; caches are next; main memory is larger and slower; persistent storage is larger still and nonvolatile.
- SRAM is faster and used for caches but is more expensive per bit and uses more chip area than DRAM.
- DRAM is used for main memory.
- The hierarchy balances speed at upper levels with capacity and cost at lower levels.
- Programs begin in nonvolatile storage, are loaded into main memory, and frequently used pieces move closer to the CPU.
- Temporal locality means recently used data is likely to be used again soon.
- Spatial locality means nearby memory locations are likely to be used soon after one another.

### Related topics

- [[data-memory-interface-and-address-calculation|Data memory interface and address calculation]]
- [[single-cycle-multicycle-and-pipelined-execution|Single-cycle, multicycle, and pipelined execution]]

### Relationships

- related: [[data-memory-interface-and-address-calculation|Data memory interface and address calculation]]
- limits: [[single-cycle-multicycle-and-pipelined-execution|Single-cycle, multicycle, and pipelined execution]]

## Added from [[slides-cac-15-18-memory-hierarchy|Memory Hierarchies and Cache Organization]]

Source label: upload

Locations: Slide 82, Slide 38, Slide 40

The hierarchy works because programs exhibit locality: only a small portion of the address space is active at any moment, and access patterns cluster in time and space. The slides distinguish temporal locality from spatial locality. Temporal locality means recently used items are likely to be used again soon, such as instructions inside loops or induction variables updated repeatedly. Spatial locality means addresses near recently used addresses are also likely to be accessed soon, such as sequential instruction fetches or adjacent array elements. This principle justifies bringing nearby data into cache as a block instead of fetching only a single byte or word. It also explains why larger blocks can reduce miss rate up to a point: the extra fetched words may soon be used. Later examples on block size explicitly demonstrate spatial locality by reducing misses when two words are stored per block rather than one. Locality is therefore the foundational behavioral assumption behind caching, block transfers, and hierarchy design.

### New key points

- Programs access only a small fraction of memory at a time.
- Temporal locality predicts reuse of recently accessed items.
- Spatial locality predicts access to nearby addresses.
- Loop instructions and induction variables are examples of temporal locality.
- Sequential instruction access and array data are examples of spatial locality.
- Block-based caching relies on locality to make copied nearby data useful.
