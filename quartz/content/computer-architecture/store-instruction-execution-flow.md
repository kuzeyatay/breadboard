---
title: "Store instruction execution flow"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 101"]
related: ["data-memory-interface-and-address-calculation", "immediate-generation-and-sign-extension-in-risc-v", "datapath-and-control-partition-in-processor-design", "main-control-and-alu-control-truth-tables"]
tags: ["s-type", "immgen", "memwrite", "memread", "regwrite", "alusrc"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-101-2.png"]
---

## Store instruction execution flow

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 101

The store case `sw x9, 4(x22)` illustrates how the datapath writes a register value into memory without producing a register-file write-back result. After fetch and decode, the processor identifies `rs1 = x22` as the base-address source and `rs2 = x9` as the value to store. The S-type immediate is split across instruction fields, so `ImmGen` reconstructs it and sign-extends it to 32 bits. `ALUsrc` selects the immediate, and the ALU adds the base address from `x22` to the sign-extended offset `4` to compute the effective memory address. That result drives the data memory address input, while `Read data 2`, containing the contents of `x9`, goes directly to the data memory write-data input. Control then asserts `MemWrite = 1` and `MemRead = 0`. Because store instructions do not write a result to a destination register, `RegWrite = 0`, and the write-back mux output is irrelevant for that instruction.

### Source snapshots

![Computer Architecture-2 Page 101](/computer-architecture/assets/computer-architecture-2-page-101-2.png)

### Page-grounded details

#### Page 101

Case 3  Store Instruction

down ex/ sw x9, 4(x22)

[Diagram: S-type instruction format drawn as a horizontal bit-field box:
`imm[11:5] | rs2 | rs1 | funct3 | imm[4:0] | opcode`
with bit labels underneath:
`[31-25]   [24-20] [19-15] [14-12] [11-7] [6-0]`]

down The PC provides the current instruction address to instruction memory, and
also feeds the PC+4 adder

down Instruction memory outputs the 32 bit encoding of sw x9, 4(x22)

down The instruction is decoded as a store with fields

- rs1 = x22  (=> Read data1, base address)

- rs2 = x9  (=> Read data2, value to store)

down The immgen reconstructs the S-type immediate from its split instruction
fields and sign extends it to 32 bits

down The ALU source mux (ALUsrc) again chooses the immediate, thus the ALU
receives first input, base address from x22  second input- sign extended
immediate 4, and it performs addition (specified by ALU op) and computes
the effective address x22+4

down Result goes to the address input of data memory and Read data 2
from the register file, which is the contents of x9, goes directly to
the write data input of Data Memory, and since this is a store, the
controls are MemWrite=1 and MemRead =0 so data me

[Truncated for analysis]

### Key points

- A store instruction uses `rs1` as the base-address register and `rs2` as the source of the value to write.
- S-type immediates are reconstructed from split instruction fields by `ImmGen`.
- `ImmGen` sign-extends the store offset to 32 bits.
- `ALUsrc` selects the immediate rather than a second ALU register operand.
- The ALU computes the effective address `x22 + 4` in the example.
- `Read data 2` from the register file supplies the memory write-data input.
- Control signals are `MemWrite = 1` and `MemRead = 0`.
- No register is written back, so `RegWrite = 0`.

### Related topics

- [[data-memory-interface-and-address-calculation|Data memory interface and address calculation]]
- [[immediate-generation-and-sign-extension-in-risc-v|Immediate generation and sign extension in RISC-V]]
- [[datapath-and-control-partition-in-processor-design|Datapath and control partition in processor design]]
- [[main-control-and-alu-control-truth-tables|Main control and ALU control truth tables]]

### Relationships

- depends-on: [[main-control-and-alu-control-truth-tables|Main control and ALU control truth tables]]
