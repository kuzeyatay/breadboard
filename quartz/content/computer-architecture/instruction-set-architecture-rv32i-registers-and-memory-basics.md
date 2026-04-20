---
title: "Instruction Set Architecture, RV32I, Registers, and Memory Basics"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 60", "Page 61"]
related: ["risc-v-instruction-families-and-register-naming", "r-type-instructions-and-register-register-alu-operations", "load-store-architecture-and-byte-addressable-memory"]
tags: ["risc-v", "rv32i", "instruction-set-architecture", "register-file", "main-memory", "word", "address-bus", "data-bus"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-060-2.png", "/computer-architecture/assets/computer-architecture-2-page-061-2.png"]
---

## Instruction Set Architecture, RV32I, Registers, and Memory Basics

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 60, Page 61

The notes introduce the instruction set architecture as the interface between software and hardware. A programmer may write in a high-level language, but execution proceeds through compilation to assembly and assembly to binary machine language before the CPU runs the instructions. In this course the target ISA is RISC-V, specifically RV32I, meaning 32-bit registers and 32-bit instructions in the base integer instruction set. The machine includes 32 registers, so each register number fits in 5 bits. The memory model is byte-addressable with 2^32 addresses, each storing one byte, giving a 4 GiB address space. Because a word in RV32I is 32 bits, a word occupies 4 consecutive byte addresses; halfword means 16 bits and doubleword means 64 bits. The notes also distinguish the register file, which is small and fast and located near the CPU, from main memory, which is much larger but slower, and mention caches as small fast memories that hold recently used RAM data.

### Source snapshots

![Computer Architecture-2 Page 60](/computer-architecture/assets/computer-architecture-2-page-060-2.png)

![Computer Architecture-2 Page 61](/computer-architecture/assets/computer-architecture-2-page-061-2.png)

### Page-grounded details

#### Page 60

Comp Arc

Week 3 - lecture 1 / lecture 2

- To command a computer's hardware, you must speak its language. The words
of a computers language are called instructions, and its vocabulary is
called an instruction set. Between the c program you write and the
processor that executes binary code, sits the assembly language which
is a human readable representation of an ISA (instruction set architecture)

[diagram]
[box] High-level
programing lang
down
Compiler
down
[box] Assembly
lang
down
Assembler
down
[box] Binary
machine lang
down
[box] CPU
  [small box under CPU] Register
  file
  -> address
  -> Data
  ↔ Main
    Memory

- In this course, we use the RISC-V ISA,
Specifically RV32I (32 bit width for
registers AND instructions) (has also other variations
such as RV64I) (I means integer, implying operations
are done on integers), that contains 32 registers.

<=> Memory:
- Since each register is 32 bits wide, we consider
32 bits one unit of data the CPU treats as a
single fundamental piece. we name 32 bits "word"
to make point to this, because a word is a natural
unit of text in a human language (word = 32 bits for
RV32I), halfword = 16 bits, double word = 64 bits.

[arrow from CPU/regi

[Truncated for analysis]

#### Page 61

- An ISA is built around the physical reality of a CPU and its
memory system. To run real programs, an ISA must offer instructions
classified into a few essential families, based on the CPU.

1) It must include instructions for Arithmetic and logical instructions

2) It must include instructions on how to access values inside Memory,

3). It must include instructions to define control flow such as loops,
conditionals etc

These ideas lead to 6 instruction formats/types:

1. R-type (register-register ALU)

2. I-type (immediate / loads / jalr)

3. S-type (stores)

4. B-type (branches)

5. J-type (Jump)

6. U-type (upper immediate)

### Key points

- Instructions are the words of the computer's language, and the vocabulary is the instruction set.
- Assembly language is a human-readable representation of an ISA.
- The course uses RISC-V RV32I.
- RV32I has 32-bit registers and 32-bit instructions.
- The base integer register file contains 32 registers, requiring 5-bit register addresses.
- Memory is byte-addressable with 2^32 addresses.
- A word is 32 bits, a halfword is 16 bits, and a doubleword is 64 bits.
- The address bus carries addresses and the data bus carries word data.

### Related topics

- [[risc-v-instruction-families-and-register-naming|RISC-V Instruction Families and Register Naming]]
- [[r-type-instructions-and-register-register-alu-operations|R-Type Instructions and Register-Register ALU Operations]]
- [[load-store-architecture-and-byte-addressable-memory|Load-Store Architecture and Byte-Addressable Memory]]

### Relationships

- depends-on: [[risc-v-instruction-families-and-register-naming|RISC-V Instruction Families and Register Naming]]
- depends-on: [[load-store-architecture-and-byte-addressable-memory|Load-Store Architecture and Byte-Addressable Memory]]
