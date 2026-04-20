---
title: "From High-Level Code to Assembly and Machine Language"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 5", "Page 6"]
related: ["software-layers-operating-system-compiler-and-isa", "instruction-count-cpi-and-the-full-cpu-performance-equation", "core-components-of-a-computer-system"]
tags: ["assembly-language", "machine-language", "compiler", "assembler", "risc-v", "isa", "swap"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-005.png", "/computer-architecture/assets/computer-architecture-2-page-006.png"]
---

## From High-Level Code to Assembly and Machine Language

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 5, Page 6

The notes trace program translation across three representations: high-level language, assembly language, and binary machine language. A C-style `Swap` example is shown first, then compiled into RISC-V assembly, and then assembled into binary instruction encodings. This sequence illustrates abstraction in software development: programmers usually reason at the source-language level, while processors only execute bit patterns defined by the ISA. Machine language is described as collections of bits that directly control the processor's datapath and memory access. Assembly language provides a symbolic representation of machine instructions, improving productivity compared with writing raw binary. An assembler performs the translation from assembly to machine language, while a compiler translates from a high-level language into assembly or equivalent machine-level instructions. The notes also emphasize that assembly language is ISA-specific, so x86 assembly differs from RISC-V assembly because the available instructions and encodings are not the same. This makes ISA the crucial interface binding compilers, assembly, and hardware together.

### Source snapshots

![Computer Architecture-2 Page 5](/computer-architecture/assets/computer-architecture-2-page-005.png)

![Computer Architecture-2 Page 6](/computer-architecture/assets/computer-architecture-2-page-006.png)

### Page-grounded details

#### Page 5

These layers are organized hierarchically. Application software
occupies the highest level while hardware forms the lowest level. Between
them lies system software, whose role is to translate, manage and
supervise the execution of programs on the hardware. The two most
fundamental types of systems software are the (1) operating system and the
(2) compiler.

↳ Operating System : acts as an intermediary between programs and
hardware, it manages I/O operations allocates memory and storage and
enables protected sharing of the computer among multiple programs
executing concurrently. In doing so, it hides hardware complexity
and provides a consistent environment for applications

↳ The compiler performs another essential function : translating programs
written in high-level languages, such as C or Java, into instructions
that the hardware can execute. This translation is necessary
because the processor does not understand high-level language constructs,
instead, it only understands instructions defined by its instruction
set architecture also called architecture

down Instruction Set Architecture (ISA) defines the operations that the
processor can perform, how instructions are encoded, h

[Truncated for analysis]

#### Page 6

High level language (HLL)
program in C

Swap(Size_t V[], Size_t k) {
  size_t = temp;
  temp = V[k];
  V[k] = V[k+1];
  V[k+1] = temp;
}

down
[boxed: Compiler]
down

Assembly language
program (for RISC-V)

Swap:
  slli x6, x11, 3
  add x6, x10, x6
  lw x5, 0(x6)
  lw x7, 4(x6)
  sw x7, 0(x6)
  sw x5, 4(x6)
  jalr x0, 0(x1)

down
[boxed: Assembler]
down

Binary machine language
program (for RISC-V)

000000001101000110011000
01100010100100100100100111
1061001!100010101101001100
010000010100111110100101000
100111110001001000001111

- Its important to note that assembly language differs for different
ISA's. For example, x86 and RISC-V processor don't have the
same assembly language.

### Key points

- Programs can be expressed as high-level language, assembly language, and binary machine language.
- The compiler translates high-level code into ISA-level instructions.
- The assembler translates assembly language into machine language bit patterns.
- Machine language directly controls datapath operations and memory access.
- Assembly language is a symbolic representation of machine instructions.
- Assembly languages differ across ISAs such as x86 and RISC-V.

### Related topics

- [[software-layers-operating-system-compiler-and-isa|Software Layers, Operating System, Compiler, and ISA]]
- [[instruction-count-cpi-and-the-full-cpu-performance-equation|Instruction Count, CPI, and the Full CPU Performance Equation]]
- [[core-components-of-a-computer-system|Core Components of a Computer System]]

### Relationships

- related: [[instruction-count-cpi-and-the-full-cpu-performance-equation|Instruction Count, CPI, and the Full CPU Performance Equation]]
