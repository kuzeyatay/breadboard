---
title: "Main control and ALU control truth tables"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 103", "Page 104"]
related: ["datapath-and-control-partition-in-processor-design", "32-bit-alu-organization-and-control-signals", "r-type-and-load-instruction-execution-flow", "store-instruction-execution-flow", "branch-and-jump-execution-in-the-datapath"]
tags: ["control", "alu-control", "opcode", "funct3", "funct7", "aluop", "dont-care"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-103-2.png", "/computer-architecture/assets/computer-architecture-2-page-104-2.png"]
---

## Main control and ALU control truth tables

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 103, Page 104

The control system is divided into two levels: the main control and the ALU control. The main control receives the instruction `opcode` bits `[6:0]` and produces high-level control outputs such as `ALUsrc`, `MemtoReg`, `RegWrite`, `MemRead`, `MemWrite`, `Branch`, and the two ALU-op bits. The truth table in the notes covers `R-format`, `lw`, `sw`, and `beq`, and also uses `x` entries to denote don't-care cases where an output bit may be either `0` or `1` without affecting correctness. The ALU control refines the ALU action by combining `ALUOp` with `funct7` and `funct3`. For memory operations, `ALUOp = 00` implies addition for address generation; for branch, `ALUOp = 01` implies subtraction; for R-type, `ALUOp = 10` means the exact function is selected using `funct7/funct3`, distinguishing add, sub, and, and or. This staged design reduces complexity by separating instruction-class decoding from low-level ALU-operation decoding.

### Source snapshots

![Computer Architecture-2 Page 103](/computer-architecture/assets/computer-architecture-2-page-103-2.png)

![Computer Architecture-2 Page 104](/computer-architecture/assets/computer-architecture-2-page-104-2.png)

### Page-grounded details

#### Page 103

Case 5 : Jal instruction

down ex/ Jal x0, offset

[Top-right bit-field diagram:]
imm[20] [10-1] [11] [19-12]   cd   opcode
[31]    [30-21] [20] [19-12]  [11-7] [6-0]

down Instruction memory outputs the 32-bit Jal instruction

down The instruction is decoded as a jump style. The key field here is the
20-bit jump immediate.

down The imgen reconstructs that jump immediate from the instruction bits,
sign extends it to 32 bits and then the datapath again performs a shift
left by 1

down The target address is calculated as PC = PC + offset bytes (like the branch
instruction) and the mux selects it. (PCsrc), everything else is
irrelevant (Although x0 is directed to the write register input but is
never used)

b) Control

[Diagram description:]
- A circled block labeled `control`
- Input arrow into `control` labeled `instructions [6:0]`
- Outputs from `control` listed vertically:
  `Branch`
  `MemRead`
  `Memto Reg`
  `ALUOp`
  `MemWrite`
  `ALUSRC`
  `RegWrite`
- The `Branch` line goes right to a gate near the top and contributes to `PCsrc`
- A vertical connection near the right is labeled `zero`
- `PCsrc` is labeled above the top gate/output
- A lower circled block labeled `ALU contro

[Truncated for analysis]

#### Page 104

(1) The main control receives instruction [6-0] which corresponds to
the opcode, in hardware it corresponds to a set of logical gates), and outputs a
sequence of bits. (8 bits)
down The truth table for the main control block is:

Inputs (opcode)

| Signal name | R-format | lw | sw | beq |
|---|---:|---:|---:|---:|
| I[6] | 0 | 0 | 0 | 1 |
| I[5] | 1 | 0 | 1 | 1 |
| I[4] | 1 | 0 | 0 | 0 |
| I[3] | 0 | 0 | 0 | 0 |
| I[2] | 0 | 0 | 0 | 0 |
| I[1] | 1 | 1 | 1 | 1 |
| I[0] | 1 | 1 | 1 | 1 |

Outputs

|  | R-format | lw | sw | beq |
|---|---:|---:|---:|---:|
| ALUsrc | 0 | 1 | 1 | 0 |
| MemtoReg | 0 | 1 | x | x |
| RegWrite | 1 | 1 | 0 | 0 |
| Mem Read | 0 | 1 | 0 | 0 |
| Mem Write | 0 | 0 | 1 | 0 |
| Branch | 0 | 0 | 0 | 1 |
| ALUop1 | 1 | 0 | 0 | 0 |
| ALUop2 | 0 | 0 | 0 | 1 |

ALU op includes 2 bits  {
[brace drawn grouping `ALUop1` and `ALUop2`]

[arrow pointing to the `x` entries]
x means don't care (comb input = 0 or 1 doesn't matter)

- - -

(2) ALU control receives the funct7 and funct3 bits from the
instruction memory and receives the ALU op bits and based on these
decides what the ALU operation should be. It's also a set of logical gates
and the signal it generates to the ALU i

[Truncated for analysis]

### Key points

- The main control receives the 7-bit opcode.
- Main-control outputs include `ALUsrc`, `MemtoReg`, `RegWrite`, `MemRead`, `MemWrite`, `Branch`, and two ALU-op bits.
- The main-control truth table is given for `R-format`, `lw`, `sw`, and `beq`.
- `x` in the table means don't care.
- The ALU control receives `funct7`, `funct3`, and `ALUOp`.
- For `lw` and `sw`, `ALUOp = 00` leads to ALU add (`0010`).
- For `beq`, `ALUOp = 01` leads to ALU subtract (`0110`).
- For R-type instructions, `ALUOp = 10` uses `funct7/funct3` to distinguish add, sub, and, and or.

### Related topics

- [[datapath-and-control-partition-in-processor-design|Datapath and control partition in processor design]]
- [[32-bit-alu-organization-and-control-signals|32-bit ALU organization and control signals]]
- [[r-type-and-load-instruction-execution-flow|R-type and load instruction execution flow]]
- [[store-instruction-execution-flow|Store instruction execution flow]]
- [[branch-and-jump-execution-in-the-datapath|Branch and jump execution in the datapath]]

