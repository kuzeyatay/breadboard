---
title: "Cache Hierarchy Control Boundaries"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 116"]
related: ["cache-memory-purpose-and-block-transfers", "direct-mapped-cache-placement-rule", "instruction-cache-and-data-cache-separation"]
tags: ["loads", "stores", "cache-controller", "main-memory", "disks", "operating-system", "file-system"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-116-2.png"]
---

## Cache Hierarchy Control Boundaries

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 116

Different layers of the memory hierarchy are managed by different mechanisms, and the notes emphasize this separation as a basic architectural idea. Transfers between registers and main memory are visible in the instruction set through load and store operations, meaning software explicitly requests those actions. In contrast, transfers between cache and main memory are handled automatically by cache controller hardware. The movement of data between main memory and disks is managed by the operating system and file system. This division of responsibility matters because programmers write load and store instructions, but they do not manually decide which cache blocks are filled on each miss. That task belongs to the cache controller. The page uses a processor hierarchy sketch with L1, L2, and shared L3 cache to illustrate that real systems contain multiple cache levels and that the controller must resolve where requested data reside within that hierarchy.

### Source snapshots

![Computer Architecture-2 Page 116](/computer-architecture/assets/computer-architecture-2-page-116-2.png)

### Page-grounded details

#### Page 116

down The hierarchy is also managed by different agents at different
boundries:

- Between Registers ↔ Main Memory is exposed through the
instruction set via loads and stores.

- Between cache ↔ Main Memory is handled by the cache controller
hardware

- Between main memory ↔ disks is handled by the operating
system and file system

↳ This seperation is important because while software directly
writes load and store instructions, it doesnt manage which blocks
move into the cache on each miss, thats the job of the cache controller hardware

-> Basics of Cache:

down ex/ AMD Processor with cache hierarchy

[Diagram: a processor/cache hierarchy sketch. Large central rectangle labeled "L3". On the left side are four vertical core boxes labeled from top to bottom `Core:1`, `Core:2`, `Core:3`, `Core:4`; near Core:1 and Core:2 are small boxes labeled `L1`, with two horizontal boxes below labeled `L2` and `L2`; near Core:3 and Core:4 are small boxes labeled `L1` and `L1`. On the right side are four vertical core boxes labeled from top to bottom `Core:5`, `Core:6`, `Core:7`, `Core:8`; near Core:5 and Core:6 are small boxes labeled `L1`, with two horizontal boxes below labeled `L2` and `L2`; n

[Truncated for analysis]

### Key points

- Register to main-memory access is exposed through loads and stores.
- Cache to main-memory block movement is handled by cache controller hardware.
- Main memory to disk transfer is handled by the operating system and file system.
- Software does not choose which block enters cache on a miss.
- This separation clarifies what is managed by hardware versus software.
- Modern processors use multi-level cache hierarchies such as L1, L2, and L3.

### Related topics

- [[cache-memory-purpose-and-block-transfers|Cache Memory Purpose and Block Transfers]]
- [[direct-mapped-cache-placement-rule|Direct Mapped Cache Placement Rule]]
- [[instruction-cache-and-data-cache-separation|Instruction Cache and Data Cache Separation]]

### Relationships

- related: [[instruction-cache-and-data-cache-separation|Instruction Cache and Data Cache Separation]]

## Added from [[slides-cac-15-18-memory-hierarchy|Memory Hierarchies and Cache Organization]]

Source label: upload

Locations: Slide 4

Different levels of the hierarchy are managed by different system components. The slides emphasize that movement between registers and main memory is largely under compiler and programmer control, while movement between cache and main memory is handled automatically by cache controller hardware. Transfers between main memory and disk are managed by the operating system through virtual memory, with hardware assistance for virtual-to-physical address translation. The programmer also participates in disk-level organization through files. This division matters because it distinguishes explicit placement decisions from transparent hardware-managed caching. A program may directly influence register allocation and file usage, but it typically experiences cache behavior indirectly through access patterns. Understanding who manages each boundary helps explain why some performance issues can be solved in software and others require architectural mechanisms. It also frames caches as a hardware automation layer that exploits locality without programmer intervention.

### New key points

- Compiler and programmer manage movement involving registers.
- Cache to main memory movement is managed by cache controller hardware.
- Main memory to disk movement is handled by the operating system as virtual memory.
- Virtual-to-physical address mapping is hardware assisted.
- Programmers explicitly manage files at the disk level.
- Caching is largely transparent hardware management.
