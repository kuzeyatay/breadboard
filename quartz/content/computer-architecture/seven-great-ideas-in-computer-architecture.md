---
title: "Seven Great Ideas in Computer Architecture"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 3", "Page 4"]
related: ["memory-hierarchy-and-i-o-in-real-systems", "software-layers-operating-system-compiler-and-isa", "cpu-time-clocking-and-the-basic-performance-equation", "performance-metrics-execution-time-cpu-time-and-response-time"]
tags: ["abstraction", "making-the-common-case-fast", "parallelism", "pipelining", "prediction", "memory-hierarchy", "dependability"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-003.png", "/computer-architecture/assets/computer-architecture-2-page-004.png"]
---

## Seven Great Ideas in Computer Architecture

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 3, Page 4

The notes present seven long-lasting design principles that form a unifying framework for the course. First, abstraction manages complexity by hiding lower-level details and exposing only what is necessary at a given level. Second, making the common case fast usually improves performance more than optimizing rare cases. Third, parallelism improves performance by executing multiple operations at the same time. Fourth, pipelining is a specific form of parallelism in which stages of instruction execution overlap to increase throughput. Fifth, prediction allows the processor to guess outcomes and continue without waiting for confirmation. Sixth, memory hierarchy balances speed, capacity, and cost by placing small, fast memories close to the processor and larger, slower memories farther away. Seventh, dependability through redundancy improves reliability by duplicating critical components so failures can be detected and tolerated. These ideas are not isolated facts: later pages show abstraction in the software stack, memory hierarchy in SRAM and DRAM placement, and performance trade-offs through clocking and logic depth.

### Source snapshots

![Computer Architecture-2 Page 3](/computer-architecture/assets/computer-architecture-2-page-003.png)

![Computer Architecture-2 Page 4](/computer-architecture/assets/computer-architecture-2-page-004.png)

### Page-grounded details

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

### Key points

- Abstraction hides lower-level details to simplify design.
- Making the common case fast gives greater performance benefit than optimizing rare cases.
- Parallelism executes multiple operations simultaneously.
- Pipelining overlaps instruction stages to increase throughput.
- Prediction allows progress before outcomes are confirmed.
- Memory hierarchy balances fast access, large capacity, and low cost.
- Dependability through redundancy improves reliability by duplication.

### Related topics

- [[software-layers-operating-system-compiler-and-isa|Software Layers, Operating System, Compiler, and ISA]]
- [[cpu-time-clocking-and-the-basic-performance-equation|CPU Time, Clocking, and the Basic Performance Equation]]
- [[performance-metrics-execution-time-cpu-time-and-response-time|Performance Metrics: Execution Time, CPU Time, and Response Time]]

### Relationships

- applies-to: [[software-layers-operating-system-compiler-and-isa|Software Layers, Operating System, Compiler, and ISA]]
- applies-to: [[cpu-time-clocking-and-the-basic-performance-equation|CPU Time, Clocking, and the Basic Performance Equation]]
- applies-to: [[performance-metrics-execution-time-cpu-time-and-response-time|Performance Metrics: Execution Time, CPU Time, and Response Time]]
