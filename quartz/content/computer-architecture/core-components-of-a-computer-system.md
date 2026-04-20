---
title: "Core Components of a Computer System"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 1", "Page 2", "Page 3"]
related: ["single-cycle-datapath-and-five-classic-computer-components", "computer-architecture-versus-computer-organization", "software-layers-operating-system-compiler-and-isa"]
tags: ["processor", "memory", "input-output", "cpu-core", "datapath", "control-logic", "apple-a7"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-001.png", "/computer-architecture/assets/computer-architecture-2-page-002.png"]
---

## Core Components of a Computer System

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 1, Page 2, Page 3

The notes define a computer system as a machine that transforms inputs into outputs according to precise rules specified by programs. To do this reliably and efficiently, every computer must support three fundamental functions: storing information, manipulating information, and communicating with the outside world. These requirements map to the three core hardware subsystems: the processor, memory, and input/output. The processor performs computation by executing instructions for arithmetic, logic, data movement, and control flow. Memory stores instructions, input data, and intermediate or final results so the processor can retrieve them when needed. Input/output connects the machine to external sources and destinations such as sensors, keyboards, displays, networks, and storage devices. The notes emphasize that these same conceptual roles appear across very different physical systems, from embedded devices to large servers. An Apple A7 chip is used as a concrete example: a CPU core provides datapath and control logic, on-chip and off-chip memories provide storage, and peripheral interfaces plus GPU/media units handle external communication and specialized processing.

### Source snapshots

![Computer Architecture-2 Page 1](/computer-architecture/assets/computer-architecture-2-page-001.png)

![Computer Architecture-2 Page 2](/computer-architecture/assets/computer-architecture-2-page-002.png)

### Page-grounded details

#### Page 1

Computer architecture . Y1 Q3

Lecture 1 week 1                                           ↳ FSM, circuits, Verilog in parallel w Processor design

-> Introduction
- A computer system exists to transform inputs into outputs according to
a precise set of rules, which are defined by user typed programs. While
the transformation itself is carried out by physical hardware. To perform
this task reliably and efficiently a computer must be able to (1) store
information (2) manipulate that information (3) communicate with the outside
world. These fundamental requirements give rise to the three core
components of all computer systems

1) The processor

2) Memory

3) Input output

1. The processor exists to perform computation. It executes instructions
that specifies operations such as: arithmetic, logical decisions, datastorage,
transfer operations and control of program flow. The processor determines
what operation happens next and how data is transformed, Without a
processor, a system could store information but would have no mechanism to
act on it.

downdown
In a real system such as the Apple A7 chip, this role is generalized
by a central processing core (CPU core) that contains a datapat

[Truncated for analysis]

#### Page 2

2). Memory exists because computation requires data and instructions
to be available when needed. Programs consists of many instructions,
and computations often depend on intermediate results that must be
retained over time. Memory provides a place to store instructions,
input data and results so that the processor can retrieve and
reuse them. Because accessing distant storage is slow and energy
expensive, memory is organized hierarchically, with smaller and
faster memories placed closer to the processor,

down ex/ In an Apple A7 chip, this hierarchy as cache memory (small,
fast form memory) implemented in fast on-chip SRAM (Static random access
memory) such as L1 (faster, smaller) and L2 (slower, larger memory) located
near the CPU datapath, along with memory interfaces to external
DRAM (Dynamic random access memory) which store larger program
and data set and is generally used as the main memory. Note that
SRAM and DRAM are both subcategories of RAM when people say
the RAM in your computer they almost always mean DRAM only (eg: 16GB of RAM)

3). Input and Out put components (I/O) exist because a computer does not
operate in isolation. Input mechanisms allow data and commands to
e

[Truncated for analysis]

#### Page 3

↳ Together, the processor, memory, and input / output form a complete system
for computation. Data enters the system through Input, is stored in memory,
processed by the processor, and then written back to memory or sent out
through output. Although the physical realization may vary greatly from
large servers to embedded devices, the same conceptual structure appears in all computers.

↳ The rules governing how the processor interprets instructions and
accesses memory are defined by computer architecture, it specifies the
programmer visible behaviour of the system, including the instruction set,
data representation, and memory model. Programs are written to this
specification and rely on it for correctness.

↳ The physical realization of this specification is realized by the
computer organization. Computer organization determines how hardware components
are arranged and interconnected to implement the architectural behaviour efficiently.
Different organizations may implement the same architecture while making
different trade-offs in performance, power consumption and cost

=> Seven great ideas in Computer Architecture:
- We now introduce Seven great ideas that computer architects h

[Truncated for analysis]

### Key points

- A computer system transforms inputs into outputs according to rules defined by programs.
- The three core components are processor, memory, and input/output.
- The processor executes instructions for arithmetic, logic, storage transfer, and program flow control.
- Memory stores instructions, input data, and intermediate or final results for later reuse.
- Input mechanisms bring data and commands into the system from sources such as sensors, keyboards, networks, and storage devices.
- Output mechanisms return results as displays, stored data, or control signals.
- The same conceptual structure appears in all computers even when the physical implementation differs.

### Related topics

- [[single-cycle-datapath-and-five-classic-computer-components|Single-Cycle Datapath and Five Classic Computer Components]]
- [[computer-architecture-versus-computer-organization|Computer Architecture Versus Computer Organization]]
- [[software-layers-operating-system-compiler-and-isa|Software Layers, Operating System, Compiler, and ISA]]

### Relationships

- part-of: [[single-cycle-datapath-and-five-classic-computer-components|Single-Cycle Datapath and Five Classic Computer Components]]
- related: [[computer-architecture-versus-computer-organization|Computer Architecture Versus Computer Organization]]
- related: [[software-layers-operating-system-compiler-and-isa|Software Layers, Operating System, Compiler, and ISA]]
