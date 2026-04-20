---
title: "Block Size Trade Offs and Spatial Locality"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 122"]
related: ["cache-performance-equations-with-cpi-stall", "average-memory-access-time", "cache-memory-purpose-and-block-transfers"]
tags: ["spatial-locality", "block-size", "miss-rate", "miss-penalty", "pollution", "cache-space"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-122-2.png"]
---

## Block Size Trade Offs and Spatial Locality

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 122

The notes explain that larger cache blocks can improve performance because of spatial locality: when one word is needed, nearby words are often needed soon afterward. By fetching a larger block, the cache may convert future accesses into hits without requiring another trip to memory. However, the improvement is limited and introduces trade-offs. In a fixed-size cache, increasing block size reduces the total number of blocks that fit in the cache, which increases competition among memory regions for available space. Larger blocks can also cause cache pollution, meaning the cache holds nearby data that were fetched but never actually used. The notes also emphasize that larger blocks increase miss penalty because memory interfaces transfer only a limited amount of data at a time, often one word or a few words per transfer. Thus, block size tuning requires balancing improved locality against reduced capacity efficiency and longer refill time.

### Source snapshots

![Computer Architecture-2 Page 122](/computer-architecture/assets/computer-architecture-2-page-122-2.png)

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

### Key points

- Larger blocks can exploit spatial locality.
- Fetching nearby words can turn future references into hits.
- Increasing block size can reduce miss rate.
- In a fixed-size cache, larger blocks mean fewer total blocks.
- Fewer blocks increase competition for cache space.
- Larger blocks can cause pollution by storing unused nearby data.
- Larger blocks increase miss penalty because transfers take longer.
- Choosing block size is a trade-off rather than a one-way improvement.

### Related topics

- [[cache-performance-equations-with-cpi-stall|Cache Performance Equations with CPI Stall]]
- [[average-memory-access-time|Average Memory Access Time]]
- [[cache-memory-purpose-and-block-transfers|Cache Memory Purpose and Block Transfers]]

### Relationships

- applies-to: [[average-memory-access-time|Average Memory Access Time]]
- causes: [[cache-performance-equations-with-cpi-stall|Cache Performance Equations with CPI Stall]]

## Added from [[slides-cac-15-18-memory-hierarchy|Memory Hierarchies and Cache Organization]]

Source label: upload

Locations: Slide 48

Although larger blocks can lower miss rate by exploiting spatial locality, the slides stress that block size is a tradeoff rather than a monotonic improvement. In a fixed-size cache, larger blocks mean there are fewer total blocks available, so more memory regions compete for each location. This can increase miss rate through additional contention and can also lead to cache pollution, where fetched data occupies space without being reused. Larger blocks further increase miss penalty because more data must be transferred on a miss. The slides explicitly note that these negative effects can outweigh the benefit of reduced miss rate. This topic connects design parameters to both miss behavior and timing cost, and it clarifies why practical caches choose block sizes carefully rather than simply maximizing them. The earlier spatial-locality examples illustrate the upside, while this slide gives the balancing argument.

### New key points

- Larger blocks can reduce miss rate by exploiting spatial locality.
- In a fixed-size cache, larger blocks mean fewer total blocks.
- Fewer blocks increase competition among memory regions.
- Larger blocks can cause cache pollution.
- Larger blocks increase miss penalty because more data is transferred.
- The larger miss penalty can override the miss-rate benefit.
