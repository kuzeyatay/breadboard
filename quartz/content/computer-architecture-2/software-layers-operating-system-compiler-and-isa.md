---
title: "Software Layers, Operating System, Compiler, and ISA"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 4", "Page 5"]
related: ["computer-architecture-versus-computer-organization", "from-high-level-code-to-assembly-and-machine-language", "core-components-of-a-computer-system"]
tags: ["operating-system", "compiler", "instruction-set-architecture", "risc-v", "system-software", "application-software", "hardware"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-004.png", "/computer-architecture/assets/computer-architecture-2-page-005.png"]
---

## Software Layers, Operating System, Compiler, and ISA

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 4, Page 5

The notes explain that modern software is far more complex than the primitive operations hardware can execute directly, so multiple layers are needed to bridge the gap. The three-layer diagram places application software at the top, system software in the middle, and hardware at the bottom. System software has two especially important components: the operating system and the compiler. The operating system intermediates between programs and hardware by managing I/O, allocating memory and storage, and enabling protected sharing among concurrent programs. The compiler translates high-level languages such as C or Java into instructions the processor can execute. Those instructions are defined by the instruction set architecture, or ISA, which is described as the lowest software-visible interface of hardware. ISA specifies the operations the processor can perform, how instructions are encoded, how registers are used, and how memory is accessed. The notes list examples including x86, ARM8, MIPS, OpenRISC, and RISC-V, with RISC-V being the ISA used in the course.

### Source snapshots

![Computer Architecture-2 Page 4](/computer-architecture/assets/computer-architecture-2-page-004.png)

![Computer Architecture-2 Page 5](/computer-architecture/assets/computer-architecture-2-page-005.png)

### Page-grounded details

#### Page 4

3 Parallelism: improves performance by allowing multiple operations
to be executed simultaneously

4 Pipelining is a specific and widely used form of parallelism in which
different stages of instruction execution overlap in time. By breaking
execution into stages and processing multiple instructions at the same
time throughput is increased without requiring faster individual operations

5 Prediction: improves performance by allowing the processor to guess
the outcome of certain operations and proceed without waiting for
confirmation

6 Memory Hierarchy addresses the conflicting goals of fast access,
large capacity and low cost by organizing memory into levels. Small,
fast and expensive memories are placed close to the processor while
larger, slower and cheaper memories are placed farther away, giving
the illusion of a memory that is both fast and reliable

7. Dependability trough redundancy ensures reliable operation by
duplicating critical components so that failures can be detected and
tolerated. Redundancy allows systems to continue functioning
correctly even when individual parts fail

=> Below your Program:

- Modern applications such as word processors or database systems
con

[Truncated for analysis]

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

### Key points

- Application software, system software, and hardware form a software-hardware hierarchy.
- System software translates, manages, and supervises program execution on hardware.
- The operating system manages I/O, memory, storage, and protected sharing among multiple programs.
- The compiler translates high-level language programs into machine-executable instructions.
- The ISA is the lowest software-visible interface of hardware.
- ISA defines operations, instruction encoding, register usage, and memory access.
- Examples of ISAs listed are x86, ARM8, MIPS, OpenRISC, and RISC-V.

### Related topics

- [[computer-architecture-versus-computer-organization|Computer Architecture Versus Computer Organization]]
- [[from-high-level-code-to-assembly-and-machine-language|From High-Level Code to Assembly and Machine Language]]
- [[core-components-of-a-computer-system|Core Components of a Computer System]]

### Relationships

- depends-on: [[from-high-level-code-to-assembly-and-machine-language|From High-Level Code to Assembly and Machine Language]]
- part-of: [[computer-architecture-versus-computer-organization|Computer Architecture Versus Computer Organization]]
