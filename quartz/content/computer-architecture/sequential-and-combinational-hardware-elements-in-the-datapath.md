---
title: "Sequential and Combinational Hardware Elements in the Datapath"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 88"]
related: ["single-cycle-processor-datapath-and-control-overview", "r-type-instructions-and-register-register-alu-operations", "i-type-immediates-loads-and-compare-instructions"]
tags: ["sequential-elements", "combinational-elements", "program-counter", "register-file", "instruction-memory", "alu", "immediate-generator", "mux"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-088-2.png"]
---

## Sequential and Combinational Hardware Elements in the Datapath

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 88

The notes conclude by categorizing the hardware blocks used in the single-cycle processor into sequential and combinational elements. Sequential elements hold state across clock cycles. The pages identify the program counter register, the register file, and instruction memory as major sequential or storage-like blocks, and note that data memory also has sequential behavior. The register file accepts two 5-bit read-register indices, one 5-bit write-register index, a write-data input, and a write-enable control, and produces two read-data outputs. Instruction memory maps an instruction address to a 32-bit instruction. Combinational elements transform current inputs without storing state. The notes list an adder that produces a sum, an ALU controlled by a 3-bit operation input and producing both `zero` and `result`, an immediate generator or sign-extension unit that expands immediate fields to 32 bits, and a multiplexer with select `S` that chooses between two inputs. These elements are the reusable hardware vocabulary from which the datapath is constructed.

### Source snapshots

![Computer Architecture-2 Page 88](/computer-architecture/assets/computer-architecture-2-page-088-2.png)

### Page-grounded details

#### Page 88

-> The processor is built from the following combinational and
sequential elements:

1. Sequential Elements

a)

-> [diagram: arrow into a small vertical rectangle labeled `PC`, arrow out to the right]

- Program Counter   Register
contents

b)

[diagram: large rectangular block with labeled ports and arrows]

Left inputs into block:
- `5 bits` -> `Read Register1`
- `5 bits` -> `Read Register2`
- `5 bits` -> `Write Register`
- `data` -> `Write data`

Bottom input into block:
- upward arrow labeled `write?`

Right outputs from block:
- `Read data1`
- `Read data2`

Right side brace label:
- `Data`

- register file

c)

[diagram: rectangular block]

Left input:
- `Instruction Address`

Right output:
- `Instruction`
- `[31:0]`

- Instruction memory

down combinational elements

a)

[diagram: adder symbol]

Left inputs:
- `input1`
- `input2`

Inside:
- `add`

Right output:
- `sum`

- Adder

b)

[diagram: ALU symbol]

Left inputs:
- `input1`
- `input2`

Top input:
- `3` -> `ALU control`
- `(operation)`

Right outputs:
- `zero`
- `result`

- A.L.U
(Arithmetic logic unit)

c)

[diagram: oval/circle]

Left input:
- `~120?0` [unclear]
- `(Imm`
  `gen`

Right output:
- `32`

- imm gen / sign-

[Truncated for analysis]

### Key points

- Sequential elements store state between cycles.
- The PC is a register that stores the current instruction address.
- The register file supports two reads and one write.
- Instruction memory outputs a 32-bit instruction for a given address.
- Data memory participates in load/store operations and has storage behavior.
- Adders, ALUs, immediate generators, and multiplexers are combinational.
- The ALU produces both a result and a zero flag.

### Related topics

- [[single-cycle-processor-datapath-and-control-overview|Single-Cycle Processor Datapath and Control Overview]]
- [[r-type-instructions-and-register-register-alu-operations|R-Type Instructions and Register-Register ALU Operations]]
- [[i-type-immediates-loads-and-compare-instructions|I-Type Immediates, Loads, and Compare Instructions]]

### Relationships

- part-of: [[single-cycle-processor-datapath-and-control-overview|Single-Cycle Processor Datapath and Control Overview]]
