---
title: "Single-Cycle Processor Datapath and Control Overview"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 86", "Page 87"]
related: ["moore-and-mealy-timing-and-combinational-path-tradeoffs", "r-type-instructions-and-register-register-alu-operations", "load-store-architecture-and-byte-addressable-memory", "sequential-and-combinational-hardware-elements-in-the-datapath"]
tags: ["single-cycle-processor", "datapath", "control", "alu", "register-file", "data-memory", "multiplexer"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-086-2.png", "/computer-architecture/assets/computer-architecture-2-page-087-2.png"]
---

## Single-Cycle Processor Datapath and Control Overview

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 86, Page 87

The final pages shift from assembly programming to processor implementation. A processor is described as a combination of combinational and sequential hardware elements. The datapath is the set of elements and interconnections that move values, perform computations, and store state during instruction execution, while the control hardware drives control inputs to select the correct behavior for each instruction. The overview diagram includes the program counter, instruction memory, register file, immediate generator, ALU control, ALU, data memory, adders, multiplexers, and a control block. Data flows from the PC into instruction memory, instruction fields fan out to control logic, register specifiers, and immediate generation, register outputs feed the ALU, the ALU result either addresses data memory or goes directly to writeback, and a writeback multiplexer chooses whether the register file receives ALU output or loaded memory data. The branch path adds 4 to the PC for sequential execution or adds a shifted immediate offset for a branch target, with an AND gate combining branch control and ALU zero to decide the PC-select multiplexer. The notes also identify the main sequential and combinational building blocks separately.

### Source snapshots

![Computer Architecture-2 Page 86](/computer-architecture/assets/computer-architecture-2-page-086-2.png)

![Computer Architecture-2 Page 87](/computer-architecture/assets/computer-architecture-2-page-087-2.png)

### Page-grounded details

#### Page 86

Lectures 1-2 week 5

=> Single- Cycle Processor Design: Datapath and Control

Processor is a collection of two broad classes of hardware elements.
Some elements are combinational or the others are sequential. The datapath
is a set of combinational and sequential elements connected by wires
or buses and performing computation, and hardware commands those
datapath elements by driving their control inputs.

down A Processor datapath is made up of the hardware blocks that let
the processor execute instructions by moving data from one place
to another and performing operations on it. The program counter (PC)
keeps track of current instruction address, the instruction
memory provides the instruction, the register file stores operands
and results, and the ALU carries out arithmetic and logic operations.
Other parts, such as multiplexers and adders, help route data and
calculate addresses, while data memory is used when instructions
need to load from or store to memory. Together, they form the
main working path through which instructions are executed,။

#### Page 87

- Processor Datapath overview (Single cycle)

No. __________
Date     /   /

[Large boxed diagram]

Top-left:
Su  Mo  Tu  We  Th  Fr  Sa

Diagram elements and labels, left to right / top to bottom:

- `PC`
- `Read address`
- `Instruction Memory`
- `instruction[31:0]`

Upper-left adder:
- `Add`
- `4`
- `sum`

Upper-right adder and selector:
- `add`
- `sum`
- `shift left by 4`
- `MUX`
- `0`
- `1`
- `S`

Control block:
- `control`

Control signals listed from top to bottom:
- `Branch`
- `MemRead`
- `MemtoReg`
- `ALUOp`
- `Memwrite`
- `ALUSrc`
- `Reg_write`

Instruction field labels:
- `Instruction[31-26]`
- `Instruction[25-21]`
- `Instruction[20-16]`
- `Instruction[15-11]`
- `Instruction[15-0]`

Register file block:
- `write ?`
- `Read register1`
- `read`
- `register2`
- `write`
- `register`
- `write`
- `data`
- `read`
- `data1`
- `read`
- `data2`
- `Registers`

ALU area:
- `MUX`
- `0`
- `1`
- `S`
- `ALU`
- `zero`
- `result`
- `operation`

Memory block:
- `write.`
- `Read`
- `data`
- `Adress`
- `write`
- `data`
- `Data`
- `Memory`
- `read`
- `data`

Right-side writeback selector:
- `MUX`
- `0`
- `1`
- `S`

Lower area:
- `12->20`
- `Imm`
- `Gen`
- `32`
- `ALU`
- `control`
- `func3 / fu

[Truncated for analysis]

### Key points

- A processor consists of combinational and sequential hardware elements.
- The datapath moves instruction bits, operands, addresses, and results.
- The control unit generates signals such as Branch, MemRead, MemtoReg, ALUOp, MemWrite, ALUSrc, and RegWrite.
- The PC, instruction memory, register file, and data memory are central stateful or storage-related blocks.
- Multiplexers choose among alternative data sources such as register versus immediate or ALU result versus memory data.
- Branch execution depends on both a branch-control signal and the ALU zero output.
- Immediate generation and ALU control decode instruction fields for execution.

### Related topics

- [[moore-and-mealy-timing-and-combinational-path-tradeoffs|Moore and Mealy Timing and Combinational Path Tradeoffs]]
- [[r-type-instructions-and-register-register-alu-operations|R-Type Instructions and Register-Register ALU Operations]]
- [[load-store-architecture-and-byte-addressable-memory|Load-Store Architecture and Byte-Addressable Memory]]
- [[sequential-and-combinational-hardware-elements-in-the-datapath|Sequential and Combinational Hardware Elements in the Datapath]]

### Relationships

- depends-on: [[sequential-and-combinational-hardware-elements-in-the-datapath|Sequential and Combinational Hardware Elements in the Datapath]]
