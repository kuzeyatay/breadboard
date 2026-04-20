---
title: "slides-CAC-15-18-memory_hierarchy"
date: "2026-04-20T10:32:53.130Z"
source: "upload"
knowledge_type: "source-document"
source_type: "pptx"
source_file: "slides-CAC-15-18-memory_hierarchy.pptx"
generated_by: "chatmock"
topics: []
tags: ["cac-memory", "memory-hierarchy", "slides-cac", "cac"]
---

## Summary

5EIC0 – Computer Architecture I Memory Hierarchies Egor Bondarev Associate Professor Head of 3D Vision Lab, VCA/SPS group, EE, TUE

---

10 Taking Advantage of Locality Store all data in cache? Not possible – small size Use memory hierarchy Store everything on disk Copy recently accessed (and nearby

## Knowledge tree

- No knowledge topics were extracted.

## Source material

5EIC0 - Computer Architecture I Memory Hierarchies Egor Bondarev Associate Professor Head of 3D Vision Lab, VCA/SPS group, EE, TUE

---

10 Taking Advantage of Locality Store all data in cache? Not possible - small size Use memory hierarchy Store everything on disk Copy recently accessed (and nearby) items from disk to smaller DRAM memory Main memory Copy more recently accessed (and nearby) items from DRAM to smaller SRAM memory Cache memory inside/attached to CPU style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility

---

So, When Processor Reads Data Block ( aka line): unit of copying May be multiple words If required data is present in upper fast level (cache) Hit : access satisfied by upper level Hit ratio: hits/accesses If required data is absent Miss : block copied from lower slow level (main memory) Time taken: miss penalty Miss ratio: misses/accesses = 1 - hit ratio Then accessed data supplied from upper level I want data block Yes, i ts available in cache: hit No, not available in cache: miss Copy data from memory to cache, then read from cache Registers Cache Main Memory style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility

---

How is the Hierarchy Managed? registers  main memory by compiler (programmer) cache  main memory by the cache controller hardware main memory  disks by the operating system (virtual memory) virtual to physical address mapping assisted by the hardware by the programmer (files) style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility

---

13 Basics of Cache

---

AMD Processor with Cache Hierarchy L1

---

When processor wants to read data: How do we know if a data item is in the cache? If it is, how do we find it? Our first example , assuming: Block size is one 'word' of data (4 memory locations - 4 bytes) Direct mapping - type of cache-memory mapping For each memory block : there is exactly one location in the cache where it might be. e.g., lots of memory blocks share one specific location in cache Cache Usage in Action

---

16 Direct Mapped Cache

---

One cache location is used for several memory blocks Memory blocks are 'fighting' for their single cache location Direct Mapped Cache memory block

---

Imagine, we have 8 cache locations Memory has 32 memory blocks Each cache location stores one of four (32/8) possible memory blocks Example: Direct Mapped Cache memory block style.visibility style.visibility style.visibility style.visibility

---

Imagine, we have 8 cache locations Memory has 32 memory blocks Mapping 'mem cache' : apply operation modulo the number of locations in the cache Cache block number = (Memory block address) modulo (#Locations in cache) Where memory block 12 is placed in cache? Cache block number = 12 modulo 8 = 4 Note, that also memory blocks 4, 20 and 28 are competing to take cache location 4 Where memory block 11 is placed in cache? Cache block number = 11 modulo 8 = 3 Mem 8 is in cache 0, mem 2 is in cache 2, etc How do we find WHERE memory data lays in cache? 15 14 13 12 11 10 9 8 7 6 5 4 3 2 1 0 31 memory cache 7 6 5 4 3 2 1 0 . . style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility

---

Welcome! This hour: Memory Organization Memory Hierarchies Basics of Caches Cache Performance Material: Book of Patterson & Hennessy chapter 5: 5.1 - 5.4 CA quizzes: Week 7

---

20 Finding WHICH memory data lays in cache slot? How do we know which particular memory block is currently stored in a cache location? Just need to organize cache structure in a smart way... memory block style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility

---

21 Finding WHICH memory data is in cache slot? How do we know which particular memory block is stored in a cache location? Store to cache: mem block address + the actual data from memory Actually, only need the high-order bits from block address Called the tag In our example of 12, memory block address is 01100: The cache tag will be 01 Low-order bits in block address define index ( in our case 100) What if there is no data in a cache location? Cache contains Valid bit : 1 = present, 0 = not present Initially 0 memory block style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility

---

22 Cache Structure Index V bit Tag Memory Data 000 001 010 011 100 101 110 111 memory block

---

23 Cache Example Conditions: 8 cache blocks, 1 word per block, direct mapped Initial state Index V bit Tag Data 000 N 001 N 010 N 011 N 100 N 101 N 110 N 111 N

---

24 Cache Example Index V Tag Data 000 N 001 N 010 N 011 N 100 N 101 N 110 N 111 N Memory addr Binary addr Hit/miss Cache block 22 10 110 Miss 110 style.visibility style.visibility style.visibility style.visibility style.visibility

---

25 Cache Example Index V Tag Data 000 N 001 N 010 N 011 N 100 N 101 N 110 Y 10 Mem[10110] 111 N Memory addr Binary addr Hit/miss Cache block 22 10 110 Miss 110 style.visibility style.visibility style.visibility

---

26 Cache Example Index V Tag Data 000 N 001 N 010 Y 11 Mem[11010] 011 N 100 N 101 N 110 Y 10 Mem[10110] 111 N Memory addr Binary addr Hit/miss Cache block 26 11 010 Miss 010

---

27 Cache Example Index V Tag Data 000 N 001 N 010 Y 11 Mem [11010] 011 N 100 N 101 N 110 Y 10 Mem [10110] 111 N Memory addr Binary addr Hit/miss Cache block 22 10 110 Miss 110 26 11 010 Miss 010

---

28 Cache Example Index V Tag Data 000 Y 10 Mem[10000] 001 N 010 Y 11 Mem[11010] 011 Y 00 Mem[00011] 100 N 101 N 110 Y 10 Mem[10110] 111 N Memory addr Binary addr Hit/miss Cache block 16 10 000 Miss 000 3 00 011 Miss 011 16 10 000 Hit 000

---

29 Cache Example Index V Tag Data 000 Y 10 Mem[10000] 001 N 010 Y 11 Mem[11010] 011 Y 00 Mem[00011] 100 N 101 N 110 Y 10 Mem[10110] 111 N Memory addr Binary addr Hit/miss Cache block 18 10 010 Miss 010 style.visibility style.visibility style.visibility

---

3 Memory Organization

---

30 Cache Example Index V Tag Data 000 Y 10 Mem[10000] 001 N 010 Y 10 Mem[10010] 011 Y 00 Mem[00011] 100 N 101 N 110 Y 10 Mem[10110] 111 N Memory addr Binary addr Hit/miss Cache block 18 10 010 Miss 010

---

Real-World Cache Structure 31 style.visibility style.visibility

---

Real-World Cache Structure 32 This cache holds 1024 words, each word 4 bytes. a byte inside word is addressed by two lower bits of address index 0-1023 (2 10 ) - pointed from 10 middle bits in address The cache tag (20 bits) is compared against the upper portion of the address to determine whether the entry in the cache corresponds to the requested address. If the tag and upper 20 bits of the address are equal and the valid bit is 1 , then the request hits in the cache, and the word is supplied to the processor. Otherwise, a miss occurs. CPU requests data from 32 bit mem address: 000011110001110001010000010011 style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility

---

Real-World Cache Structure: Example 33 Imagine, a data from memory address 00001111000111000101 0 000010011 00 was requested by a program ( lw instruction) OK, index = 0000010011 bin = 19 dec , Check cache slot with index = 19 In slot 19 , check the currently stored t ag value and compare to 00001111000111000101 Comparison True?  hit, get data from cache False?  miss, get data from memory Last two bits (00) in the address we never consider - interested not in bytes but in words style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility

---

34 Example: Memory Block Size of One Word Cache has 64 cache blocks, stores 4 bytes per block (1 word) Exercise: To what cache block number does memory byte-address 1200 map? We already know: Cache block number = (Memory block address) modulo (#Blocks in cache) Memory block address = 1200 /4 bytes = 300 (word address) Cache block number = 300 modulo 64 = 44 , since 300 = (64*4) + 44 Tag Index Offset 0 1 2 7 8 31 2 bits 6 bits 24 bits style.visibility style.visibility style.visibility style.visibility style.visibility

---

35 Lets see the Cache Structure Variations

---

36 Block sizes Tag Index Offset 0 1 2 7 8 31 2 bits 6 bits 24 bits 1 word Tag Index Offset 0 2 3 8 9 31 3 bits 6 bits 23 bits 1 word 1 word Block size - one word (4 bytes) Block size - 2 words (8 bytes) Tag Index Offset 0 3 4 9 10 31 4 bits 6 bits 22 bits 1 word Block size - 4 words (16 bytes) 1 word 1 word 1 word style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility

---

37 Example: Larger Block Size Cache has 64 cache blocks, stores 16 bytes per block (4 words) Then, you need index of 6 bits (2 6 to address 64 cache blocks) Also, offset is byte_offset (2 bits) + word_offset (2 bits) word_offset is 2 bits since 2 2 = 4 words Total offset = 2+2 = 4 bits Tag size = what remains from 32 - 6 - 4 = 22 bits PS. word_offset is also called block_offset Tag Index Offset 0 3 4 9 10 31 4 bits 6 bits 22 bits style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility

---

38 Example: Larger Block Size Cache has 64 cache blocks, stores 16 bytes per block (4 words) Exercise: To what cache block number does memory address 1200 map? We already know: Cache block number = (Memory block address) modulo (#Blocks in cache) Memory block address =  1200 /16 bytes  = 75 Cache block number = 75 modulo 64 = 11 (since 75 = 64*1 + 11) Tag Index Offset 0 3 4 9 10 31 4 bits 6 bits 22 bits style.visibility style.visibility style.visibility style.visibility style.visibility

---

Cache block-size variations Block size = Block-offset size plus Byte-offset size Byte-offset is always 2-bits: to represent a 4-bytes word: Tag Index 2 bits 8 bits 22 bits Simple case - block contains only 2-bit byte-offset Block-offset can be 0-bit (no block offset, if a block is 1 word) Block-offset defines how many words are allocated in each cache slot Consider block-offset of 4-bits: meaning 16 (2 4 ) words per cache block: Tag Index 2 bits 4 bits 22 bits byte-offset 4 bits block-offset So, total block size is 2+4 = 6 bits, meaning one cache block stores 2 6 bytes or 2 4 words An example is coming... style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility

---

4 So Far: Processor  Memory Registers, 1 ns access time Main memory, 30 ns access time ? Clock cycle: 3 ns style.visibility style.visibility style.visibility style.visibility

---

40 Example: Intrinsity FastMATH Cache size 16KB: 256 blocks x 16 words/block 2 bits for byte offset 4 bits for block offset 16 words in block style.visibility style.visibility style.visibility

---

41 Advantage in large block size?

---

Direct Mapped Cache 0 (00 00) 1 (00 01) 2 (00 10) 3 (00 11) 4 (01 00) 3 (00 11) 4 (01 00) 15 (11 11) 4 cache slots (index = 2 bits). Block size = 4 bytes, word (tag = 2 bits) Reading words from mem addresses: 0 1 2 3 4 3 4 15 00 Mem(0) 00 Mem(0) 00 Mem(1) 00 Mem(0) 00 Mem(0) 00 Mem(1) 00 Mem(2) miss miss miss miss miss miss hit hit 00 Mem(0) 00 Mem(1) 00 Mem(2) 00 Mem(3) 01 Mem(4) 00 Mem(1) 00 Mem(2) 00 Mem(3) 01 Mem(4) 00 Mem(1) 00 Mem(2) 00 Mem(3) 01 Mem(4) 00 Mem(1) 00 Mem(2) 00 Mem(3) 01 4 11 15 00 Mem(1) 00 Mem(2) 00 Mem(3) 8 requests: 6 misses . 2 hits ind 00 ind 01 ind 10 ind 11 Defines index Defines tag

---

Taking Advantage of Spatial Locality 0 Let cache block hold more than one word - two memory words 0 1 2 3 4 3 4 15 1 2 3 4 3 4 15 Cache size remains the same Cache structure changes ind 0 ind 1

---

Taking Advantage of Spatial Locality 0 (00 0 0) Let cache block hold more than one word - two memory words Mem addresses: 0 1 2 3 4 3 4 15 00 Mem(1) Mem(0) miss ind 0 ind 1 Defines index Defines tag Defines word address style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility

---

Taking Advantage of Spatial Locality 0 (00 0 0) Let cache block hold more than one word - two memory words Mem addresses: 0 1 2 3 4 3 4 15 1 (00 0 1) 2 (00 1 0) 3 (00 1 1) 4 (01 0 0) 3 (00 1 1) 4 (01 0 0) 15 (11 1 1) 00 Mem(1) Mem(0) miss 00 Mem(1) Mem(0) hit 00 Mem(3) Mem(2) 00 Mem(1) Mem(0) miss hit 00 Mem(3) Mem(2) 00 Mem(1) Mem(0) miss 00 Mem(3) Mem(2) 00 Mem(1) Mem(0) 01 5 4 hit 00 Mem(3) Mem(2) 01 Mem(5) Mem(4) hit 00 Mem(3) Mem(2) 01 Mem(5) Mem(4) 00 Mem(3) Mem(2) 01 Mem(5) Mem(4) miss 11 15 14 8 requests, 4 misses only In case of one-word per block it would be 6 misses ind 0 ind 1 style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility

---

5EIC0 - Computer Architecture I Memory Hierarchies Egor Bondarev Associate Professor Head of 3D Vision Lab, VCA/SPS group, EE, TUE

---

Welcome! This hour: Memory Organization Cache Performance Direct mapped vs. Associative cache Material: Book of Patterson & Hennessy chapter 5: 5.1 - 5.4 CA quiz: Week 7

---

33 Exam Example A direct mapped cache with capacity of 4096 bytes has a block size of 2 words, so 8 bytes. Cache has one valid bit. The memory is addressed with addresses of size 36 bits and is, as usual, byte addressable. a) How big is the cache index in bits ? N_cache_locations (blocks) = cache_size / block_size = 4096/8 bytes -> 512 locations or blocks. So, index =  2 log 512  = 9 bits (2 9 = 512). {5C22544A-7EE6-4342-B048-85BDC9FD1C3A} Valid bit Tag Memory block data 8 bytes (2 words) {5C22544A-7EE6-4342-B048-85BDC9FD1C3A} ......................... 4096 bytes, so 4096/8 = 512 cache slots 0 1 511 510 style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility

---

33 Example A direct mapped cache with capacity of 4096 bytes has a block size of 2 words, so 8 bytes. Cache has one valid bit. The memory is addressed with addresses of size 36 bits and is, as usual, byte addressable. How big is the cache index ? - Answer: 9 bits (previous slide) The address consists of 36 bits = tag + index + word_offset + byte_offset bits. word_offset = 1 bit (2 words / block), block_offset = 2 bits (4 bytes/word) -> tag = 36 - 9 - 1 - 2 = 24 bits. b) How big is the cache tag? Tag Index 2 bits 9 bits ? byte-offset 1 bit block-offset Total = 36 bits style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility

---

5 Actual memory organization style.visibility style.visibility style.visibility

---

33 Example A direct mapped cache with capacity of 4096 bytes has a block size of 2 words, so 8 bytes. Cache has one valid bit. The memory is addressed with addresses of size 36 bits and is, as usual, byte addressable. How big is the cache index ? Answer: 9 bits c) How big , in number of bits, is the cache in total? So: cache size = N_cache_blocks * ( block_size + tag_size + valid bit) = 512 * (32*2 + 24 + 1) = 45568 bits . b) How big is the cache tag? Answer: 24 bits {5C22544A-7EE6-4342-B048-85BDC9FD1C3A} Valid bit Tag 24 bits Memory block data 8 bytes (2 words) {5C22544A-7EE6-4342-B048-85BDC9FD1C3A} ......................... 0 1 511 510 1 bit + 24 bits + 32*2 bits style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility

---

Read hits this is what we want - direct data read from cache! Read misses 1. stall the CPU, 2. fetch block from memory, 3. deliver to cache, 4. resume the load ( lw ) instruction Write hits: can write data into cache and memory ( write-through ) write the data only into the cache ( write-back into memory later) Write misses: write the entire block into the cache, then write to memory ( allocate on write miss ) do not update the cache line; just write to memory ( no allocate on write miss ) Hits vs. Misses style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility

---

52 Block Size Considerations Larger blocks should reduce miss rate Due to spatial locality But in a fixed-sized cache Larger blocks  fewer of them More competition  increased miss rate Larger blocks  pollution Larger miss penalty Can override benefit of reduced miss rate style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility

---

The performance equation: Execution time T exec = N instr x CPI x T cycle where CPI = CPI ideal + CPI stall CPI stall = %reads x missrate read x misspenalty read + %writes x missrate write x misspenalty write CPI = average number of cycles per instruction For pipelined processor: CPI ideal = 1 Cache misses increase CPI by adding stall cycles! style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility

---

Cache Types Instruction Cache (I-cache) - to store instructions Data Cache (D-cache) - to store data CPU I$ D$ Instruction Memory L1 Data Memory

---

A direct mapped cache has the following metrics for a specific program execution: * D-cache miss rate = 4% * I-cache miss rate = 6% * Miss penalty = 100 cycles * Base CPI (ideal cache) = 4.0 Furthermore, Load & Store instructions are 50% of all instructions. D-cache miss occurs only during load/store instructions Calculate the actual CPI, then compute (and write down) how much faster is the ideal processor with 4.0 CPI. Cache Performance 55 Average missed cycles per instruction: * I-cache: 6%*100 = 0.06 x 100 = 6 cycles * D-cache: 50% * 4% *100 = 0.5 x 0.04 x 100 = 2 cycles Actual CPI = CPI_base + Miss_cycles per data fetch + Miss_cycles per instruction = 4.0 + 6 + 2 = 12 So, the ideal processor is 12 / 4.0 = 3 times faster style.visibility style.visibility style.visibility style.visibility style.visibility

---

Average Memory Access Time (AMAT) A larger cache will have a longer access time (hit time). An increase in hit time will likely add another cycle to the instruction. At some point, the increase in hit time for a larger cache will overcome the improvement in hit rate leading to a decrease in performance. Average Memory Access Time (AMAT) is the average to access memory considering both hits and misses AMAT = Time for a hit + Miss rate x Miss penalty

---

Reducing Cache Miss Rates #1 Allow more flexible block placement In a direct mapped cache a memory block maps to exactly one cache block No flexibility At the other extreme, we could allow a memory block to be mapped to any cache block - fully associative cache But then we need to spend time on searching for the data A compromise is to divide the cache into sets each of which consists of n "ways" ( n-way set associative ). A memory block maps to a unique set (specified by the index field) and can be placed in any way of that set (so there are n choices) (block address) modulo (# sets in the cache) style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility

---

Increase performance Split - Instruction and Data caches Caches can be tuned differently CPU I$ D$ I&D $ Main Memory L1 L2 Use Associative mapping instead of Direct mapping

---

59 Associative Cache Mapping

---

6 Possible Memory Elements Static RAM (SRAM) $200 - $2000 per GB Dynamic RAM (DRAM) $2 - $25 per GB Magnetic disk $0.01 - $2 per GB Ideal memory Access time of SRAM Capacity and cost/GB of disk style.visibility style.visibility style.visibility

---

60 Associative Caches Fully associative Allow a given block to go in any cache slot Requires all slots to be searched at once - expensive comparator n -way set associative Each set (cache row) contains n cache slots Memory block address determines in which cache set to place data (Block number) modulo (#Sets in cache) Search all cache slots in a given set at once n comparators (less expensive)

---

61 Associative Cache Example Index V bit Tag Data 000 Y 00 Mem (#00 000 ) 001 N 010 N 011 N 100 Y 00 Mem (#00 100 ) 101 N 110 N 111 N Index V bit Tag Data 00 Y 000 Mem (#000 00 ) 01 N 10 N 11 N V bit Tag Data Y 001 Mem (#001 00 ) N N N We can re-design 8 block direct mapped cache Into 2-way associative cache Containing 4 sets of 2 blocks each a set of two blocks Memory blocks with address ending with 000 are strictly placed to single cache block 000 Memory blocks with address ending with 00 are freely placed to one of the available cache block in set 00 style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility

---

62 Associative Cache Example Index V bit Tag Data 000 00 Mem (#00 000 ) 001 010 00 Mem (#00 010 ) 011 100 00 Mem (#00 100 ) 101 110 00 Mem (#00 110 ) 111 Index V Tag Data 0 0000 Mem (#0000 0 ) 1 V Tag Data 0010 Mem (#0010 0 ) We can re-design 8 block direct mapped cache Into 4-way associative cache Containing 2 sets of 4 blocks each V Tag Data 0001 Mem (#0001 0 ) V Tag Data 0011 Mem (#0011 0 ) And so on Memory blocks with address ending with 000 are strictly placed to single cache block 000 Memory blocks with address ending with 0 are freely placed to one of the available cache block in set 0 style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility

---

63 Spectrum of Associativity For a cache with 8 entries

---

64 Associativity Example Compare performance of 4-blocks cache Direct mapped, Vs. 2-way set associative, Vs. Fully associative Given the sequence of memory block access: 0, 8, 0, 6, 8 Direct mapped Block address Cache index Hit/miss Cache content after access Index 00 Index 01 Index 10 Index 11 0 - 00000 8 - 01000 6 - 00110 style.visibility style.visibility

---

65 Associativity Example Compare performance of 4-blocks cache Direct mapped, Vs. 2-way set associative, Vs. Fully associative Given the sequence of memory block access: 0, 8, 0, 6, 8 Direct mapped Block address Cache index Hit/miss Cache content after access Index 00 Index 01 Index 10 Index 11 0 0 miss Mem[0] 8 0 miss Mem[8] 0 0 miss Mem[0] 6 2 miss Mem[0] Mem[6] 8 0 miss Mem[8] Mem[6] 0 - 00000 8 - 01000 6 - 00110

---

66 Associativity Example Compare performance of 4-blocks cache Direct mapped, Vs. 2-way set associative, Vs. Fully associative Given the sequence of memory block access: 0, 8, 0, 6, 8 Direct mapped Block address Cache index Hit/miss Cache content after access Index 00 Index 01 Index 10 Index 11 0 0 miss Mem[0] 8 0 miss Mem[8] 0 0 miss Mem[0] 6 2 miss Mem[0] Mem[6] 8 0 miss Mem[8] Mem[6] 0 - 00000 8 - 01000 6 - 00110

---

67 Associativity Example Compare performance of 4-blocks cache Direct mapped, Vs. 2-way set associative, Vs. Fully associative Given the sequence of memory block access: 0, 8, 0, 6, 8 Direct mapped Block address Cache index Hit/miss Cache content after access Index 00 Index 01 Index 10 Index 11 0 0 miss Mem[0] 8 0 miss Mem[8] 0 0 miss Mem[0] 6 2 miss Mem[0] Mem[6] 8 0 miss Mem[8] Mem[6] 0 - 00000 8 - 01000 6 - 00110

---

68 Associativity Example Compare performance of 4-blocks cache Direct mapped, Vs. 2-way set associative, Vs. Fully associative Given the sequence of memory block access: 0, 8, 0, 6, 8 Direct mapped Block address Cache index Hit/miss Cache content after access Index 00 Index 01 Index 10 Index 11 0 0 miss Mem[0] 8 0 miss Mem[8] 0 0 miss Mem[0] 6 2 miss Mem[0] Mem[6] 8 0 miss Mem[8] Mem[6] 0 - 00000 8 - 01000 6 - 00110

---

69 Associativity Example Compare performance of 4-blocks cache Direct mapped, Vs. 2-way set associative, Vs. Fully associative Given the sequence of memory block access: 0, 8, 0, 6, 8 Direct mapped Block address Cache index Hit/miss Cache content after access Index 00 Index 01 Index 10 Index 11 0 0 miss Mem[0] 8 0 miss Mem[8] 0 0 miss Mem[0] 6 2 miss Mem[0] Mem[6] 8 0 miss Mem[8] Mem[6] 0 - 00000 8 - 01000 6 - 00110

---

Memory Hierarchy, why? Users want large and fast memory! SRAM access times are 2 - 10 ns DRAM access times are 20 - 120 ns Disk access times are 5 to 10 million ns, but it's bits are very cheap Get best of both worlds: fast and large memories: build a memory hierarchy CPU Level 1 Level 2 Level n Size Speed Cache DRAM memory Disk style.visibility

---

70 Associativity Example 2-way set associative Only 2 sets for 4 blocks cache (each set contains 2 blocks) To address 2 sets, we need index of 1 bit Block address Cache index Hit/miss Cache content after access Set 0 Set 1 0 - 00000 8 - 01000 6 - 00110

---

71 Associativity Example 2-way set associative Only 2 sets for 4 blocks cache (each set contains 2 blocks) To address 2 sets, we need index of 1 bit Block address Cache index Hit/miss Cache content after access Set 0 Set 1 0 0 miss Mem[0] 8 0 miss Mem[0] Mem[8] 0 0 hit Mem[0] Mem[8] 6 0 miss Mem[0] Mem[6] 8 0 miss Mem[8] Mem[6] 0 - 00000 8 - 01000 6 - 00110

---

72 Associativity Example 2-way set associative Only 2 sets for 4 blocks cache (each set contains 2 blocks) To address 2 sets, we need index of 1 bit Block address Cache index Hit/miss Cache content after access Set 0 Set 1 0 0 miss Mem[0] 8 0 miss Mem[0] Mem[8] 0 0 hit Mem[0] Mem[8] 6 0 miss Mem[0] Mem[6] 8 0 miss Mem[8] Mem[6] 0 - 00000 8 - 01000 6 - 00110

---

73 Associativity Example 2-way set associative Only 2 sets for 4 blocks cache (each set contains 2 blocks) To address 2 sets, we need index of 1 bit Block address Cache index Hit/miss Cache content after access Set 0 Set 1 0 0 miss Mem[0] 8 0 miss Mem[0] Mem[8] 0 0 hit Mem[0] Mem[8] 6 0 miss Mem[0] Mem[6] 8 0 miss Mem[8] Mem[6] 0 - 00000 8 - 01000 6 - 00110

---

74 Associativity Example 2-way set associative Only 2 sets for 4 blocks cache (each set contains 2 blocks) To address 2 sets, we need index of 1 bit Block address Cache index Hit/miss Cache content after access Set 0 Set 1 0 0 miss Mem[0] 8 0 miss Mem[0] Mem[8] 0 0 hit Mem[0] Mem[8] 6 0 miss Mem[0] Mem[6] 8 0 miss Mem[8] Mem[6] 0 - 00000 8 - 01000 6 - 00110

---

75 Associativity Example 2-way set associative Only 2 sets for 4 blocks cache (each set contains 2 blocks) To address 2 sets, we need index of 1 bit Block address Cache index Hit/miss Cache content after access Set 0 Set 1 0 0 miss Mem[0] 8 0 miss Mem[0] Mem[8] 0 0 hit Mem[0] Mem[8] 6 0 miss Mem[0] Mem[6] 8 0 miss Mem[8] Mem[6] 0 - 00000 8 - 01000 6 - 00110

---

76 Associativity Example Block address Hit/miss Cache content after access 0 miss Mem[0] 8 miss Mem[0] Mem[8] 0 hit Mem[0] Mem[8] 6 miss Mem[0] Mem[8] Mem[6] 8 hit Mem[0] Mem[8] Mem[6] Fully associative style.visibility style.visibility

---

77 How Much Associativity Increased associativity decreases miss rate But with diminishing returns Simulation of a system with 64KB D-cache, 16-word blocks, SPEC2000 1-way, miss rate:10.3% 2-way: 8.6% 4-way: 8.3% 8-way: 8.1%

---

Chapter 5 - Large and Fast: Exploiting Memory Hierarchy - 78 Set Associative Cache Organization

---

33 Example on 2 way set-associative cache A data cache is indexed with a 6-bits index, tag size is 22 bits. Each cache block contains a tag, a block of words, 1 dirty bit, 1 valid bit; each word contains 4 bytes. The address size is 34 bits, and the memory is byte addressable. How many words are stored in one cache data block? Number of words in a cache-block = 2 (34 - 22 - 6 - 2) = 2 4 = 16 words The cache is 2 way set-associative. What is the total cache size (in bits)? Cache size (bits) = N_cache_blocks * associativity * block_size = 2 6 * 2 * (32*16 + 22 + 1 + 1) = 64 * 2 * 536 = 68.608 bits style.visibility style.visibility style.visibility style.visibility

---

8 Memory Hierarchy

---

Homework 80 To read: Book of Patterson & Hennessy Chapter 5.1 - 5.4 (Memory) Exercises: OnCourse : "CA Quiz Week 7"

---

Quiz question 81 Question: What will be the memory address (in decimal number) of the next instruction to execute after the following instruction: 0x0000206f This instruction above is given in the hexadecimal format and is located in the instruction memory address 0x00000000. Solution : First, convert the instruction 0x0000206f into binary: 0000 0000 0000 0000 0010 0000 0110 1111 Its a JAL jump instruction, since the opcode is 1101111. So lets split it in the UJ instruction format: 0 0000000000 0 00000010 00000 1101111 We see that the instruction specifies the 20-bit jump half-word offset in the fields as: 0 0000000000 0 00000010 Bits 10:1 - 0000000000; Bit 11 - 0; Bits 19:12 - 00000010; Bit 20 - 0 This means that the actual offset value is = 0 00000010 0 0000000000. Lets compute the byte offset from the half-word offset: 0 00000010 0 0000000000 <<1 (shift-left-by-1-bit) = 0 00000010 0 0000000000 0. Lets sign-extend this byte offset to 32-bit value: 00000000000 0 00000010 0 0000000000 0 The next step is to add this offset to the Program Counter (PC) address: PC (0x00000000 = 00000000000000000000000000000000) + offset (00000000000 0 00000010 0 0000000000 0) = 00000000000 0 00000010 0 0000000000 0. The resulting address is 00000000000000000010000000000000. Convert to decimal = 8192. style.visibility style.visibility style.visibility style.visibility

---

Consider a multi-cycle processor RISC-V with 5 stages as shown here. Assume the following (theoretical) timings for hardware blocks, all in ns: Adder: 5, ALU: 8, Register read: 4, Register write: 4, Instruction memory access: 6, Data memory access: 6, Each mux: 2, Imm -gen: 1, PC: 0, Shiftleft 1: 0 What is the worst-case frequency supported by this multi-cycle processor? Enter only the number, without the MHz unit. Solution : The worst-case frequency of multi-cycle processor is determined by the heaviest stage. For the 5-stage multi-cycle architecture, here the ALU stage is the heaviest, since its hardware blocks take highest amount of time. It includes Mux,and ALU itself (2ns + 8ns). Therefore, the stage requires 10 ns. Note that Shift-left and Adder in this stage are executed in parallel and are shorter in time, so they should be omitted. Therefore the worst-case frequency f_max = 1/10ns = 100 MHz. Quiz question 82 style.visibility style.visibility style.visibility style.visibility style.visibility style.visibility

---

9 How to use hierarchy? Use Principle of Locality Programs access a small proportion of their memory address space at any time Temporal locality Items accessed recently are likely to be accessed again soon e.g., instructions in a loop, induction variables Spatial locality Items near those accessed recently are likely to be accessed soon E.g., sequential instruction access, array data
