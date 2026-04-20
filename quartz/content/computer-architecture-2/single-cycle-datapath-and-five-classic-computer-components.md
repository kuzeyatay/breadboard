---
title: "Single-Cycle Datapath and Five Classic Computer Components"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 1", "Page 7"]
related: ["core-components-of-a-computer-system", "combinational-and-sequential-logic-in-processors", "logic-blocks-truth-tables-and-boolean-expressions"]
tags: ["single-cycle-datapath", "instruction-memory", "register", "alu", "data-memory", "control"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-001.png", "/computer-architecture/assets/computer-architecture-2-page-007.png"]
---

## Single-Cycle Datapath and Five Classic Computer Components

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 1, Page 7

The notes sketch a single-cycle datapath to illustrate how the processor, memory, and registers cooperate during instruction execution. The diagram includes a program counter feeding instruction memory, a register file supplying operands, an ALU performing arithmetic or logic, and data memory storing or retrieving data values. This datapath picture is later reframed as the five classic computer components: input, output, memory, datapath, and control. Datapath and control together constitute the processor. The processor fetches instructions and data from memory, while control generates the signals that direct the operations of the datapath, memory, input, and output. Input writes data into memory and output reads results from memory. This decomposition is important because it separates where data flows from how operations are coordinated. It also sets up later topics in logic design, where datapath elements are built from logic blocks and sequential state elements, while control determines which operations occur each cycle.

### Source snapshots

![Computer Architecture-2 Page 1](/computer-architecture/assets/computer-architecture-2-page-001.png)

![Computer Architecture-2 Page 7](/computer-architecture/assets/computer-architecture-2-page-007.png)

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

#### Page 7

- Now we can illustrate the five classic components which are input, output
memory, datapath, and control, with the last two combined and called
the processor

[Diagram]
- Small labeled sketch above the main box:
  - `compiler`
  - `interface`
- Main boxed diagram labeled `computer`
  - Inside left section:
    - `control`
    - `Datapath`
  - Bottom labels:
    - `processor` (under the left section containing control + datapath)
    - `Memory` (under the right section)
  - Right side labels:
    - `Input`
    - `out put`
- Separate sketch on left:
  - Magnifying glass labeled:
    - `Evaluating`
    - `Performance`

√ The processor gets instructions and data from memory. Input writes data to
memory, and output reads data from memory. Control sends the signals
that determine the operations of the datapath, memory, input and output.

->

=> Computer Performance

- Performance is a measure of how fast a computer system completes a
task. In computer architecture the only measure of performance is time,
specifically how long a program takes to run

√ Execution time : is the total time required for the computer hardware
to complete a given program. It includes the time spent by the CPU

[Truncated for analysis]

### Key points

- The single-cycle datapath diagram includes PC, instruction memory, register file, ALU, and data memory.
- The program counter supplies the address of the next instruction.
- The register file stores operands and intermediate values used by the ALU.
- The ALU performs arithmetic and logical operations on register data.
- Data memory provides storage for load and store style operations.
- The five classic components are input, output, memory, datapath, and control.
- Datapath plus control are grouped together as the processor.

### Related topics

- [[core-components-of-a-computer-system|Core Components of a Computer System]]
- [[combinational-and-sequential-logic-in-processors|Combinational and Sequential Logic in Processors]]
- [[logic-blocks-truth-tables-and-boolean-expressions|Logic Blocks, Truth Tables, and Boolean Expressions]]

### Relationships

- depends-on: [[combinational-and-sequential-logic-in-processors|Combinational and Sequential Logic in Processors]]
- depends-on: [[logic-blocks-truth-tables-and-boolean-expressions|Logic Blocks, Truth Tables, and Boolean Expressions]]
