---
title: "Cache Performance Equations with CPI Stall"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 122", "Page 123"]
related: ["hit-ratio-miss-ratio-and-miss-penalty", "instruction-cache-and-data-cache-separation", "average-memory-access-time"]
tags: ["cpi", "cpi-stall", "execution-time", "miss-penalty", "i-cache", "d-cache", "miss-rate"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-122-2.png", "/computer-architecture/assets/computer-architecture-2-page-123-2.png"]
---

## Cache Performance Equations with CPI Stall

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 122, Page 123

The notes connect cache behavior to processor performance by modifying the standard execution-time equation. Execution time remains the product of instruction count, CPI, and cycle time, but CPI must now include stall cycles caused by cache misses. For a pipelined processor, the ideal CPI is given as 1, and the actual CPI becomes CPI_ideal plus CPI_stall. The stall component is expressed as the sum of read-related and write-related miss costs: percentage of reads times read miss rate times read miss penalty, plus percentage of writes times write miss rate times write miss penalty. This formulation makes cache misses a first-class performance component rather than treating CPI as a purely architectural constant. The notes then apply this idea to split instruction and data caches, using different miss rates for each, and compute an actual CPI for a sample program. With D-cache miss rate 4%, I-cache miss rate 6%, miss penalty 100 cycles, base CPI 4, and load/store instructions equal to 50% of instructions, the average miss cost is 6 cycles for instruction fetches and 2 cycles for data accesses, giving CPI = 12. The ideal processor with CPI 4 is therefore 3 times faster.

### Source snapshots

![Computer Architecture-2 Page 122](/computer-architecture/assets/computer-architecture-2-page-122-2.png)

![Computer Architecture-2 Page 123](/computer-architecture/assets/computer-architecture-2-page-123-2.png)

### Page-grounded details

#### Page 122

√ Because of spatial locality, larger blocks can improve performance
If you bring in one word and its nearby neighbors then future
accesses may hit without another trip to memory, This is why
increasing block size can reduce miss rate

√ But this improvement is not unlimited. In a fixed-size cache,
larger blocks mean fewer total blaks and fewer blocks mean
more competition among memory blocks for cache space, more
pollution (means that cache may fill with nearby data that were fetched
speculatively because of spatial locality, but that the program never
actually uses - Those useless words occupy space that could have held
something more valuable) and a large miss penalty (because
the memory interface ony has a limited number of wires, So
data are transferred a word at a time or a few words at a time
So increasing block size slows transfer time). Therefore larger
block size is a trade-off

-> Cache Performance
- At the program level, cache behaviour matters because it
changes performance equations. Execution time is still: (execution time for a program)
cycles per instruction

execution time = number of instructions x CPI x cycle time

√ But now CPI is no longer just the ideal archi

[Truncated for analysis]

#### Page 123

[Top-left printed mini table: `Su | Mo | Tu | We | Th | Fr | Sa`]

[Top-right printed header:]
No. __________
Date      /      /

√ The cache is also split into two parts: I-cache responsible for
storing instructions and a D-cache responsible for storing
data. This is done because a processor often wants to fetch the
next instruction while also reading or writing data for a current
instruction.

√ ex/ A direct mapped cache has the following metrics for a
specific program execution:

- D-cache miss rate = 4%

- I-cache miss rate = 6%

- Miss penalty = 100 cycles

- Base CPI (ideal cache) = 4

Furthermore load & store instructions are 50% of all
instructions. Calculate the actual CPI then compute (or write
down) how much "the ideal processor with 4.0 CPI is faster

down solution. (1) Compute Average missed cycle per instruction
   down I-cache: 6% * 100 = 0.06 x 100 = 6 cycles
   down D-cache: 50% * 4% x 100 = 0.5 x 0.04 x 100 = 2 cycles.
      ↘ D-cache miss only occurs in load/store instructions, so on
         50 percent of all instructions

down CPI = (CPI ideal + Miss cycles per data fetch + Miss cycles per instruction)
   = 4 + 6 + 2 = 12

down Therefore the ideal processor is

[Truncated for analysis]

### Key points

- Execution time = number of instructions x CPI x cycle time.
- Actual CPI equals ideal CPI plus CPI stall.
- For the pipelined processor in the notes, ideal CPI is 1 as a baseline concept.
- CPI stall includes separate read and write miss contributions.
- Instruction and data cache misses can be modeled separately.
- In the worked example, I-cache contributes 6 cycles per instruction on average.
- In the worked example, D-cache contributes 2 cycles per instruction on average.
- The resulting CPI is 12, so a CPI-4 ideal processor is 3 times faster.

### Related topics

- [[hit-ratio-miss-ratio-and-miss-penalty|Hit Ratio Miss Ratio and Miss Penalty]]
- [[instruction-cache-and-data-cache-separation|Instruction Cache and Data Cache Separation]]
- [[average-memory-access-time|Average Memory Access Time]]

### Relationships

- depends-on: [[instruction-cache-and-data-cache-separation|Instruction Cache and Data Cache Separation]]
