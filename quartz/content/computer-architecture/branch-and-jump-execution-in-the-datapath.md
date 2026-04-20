---
title: "Branch and jump execution in the datapath"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 102", "Page 103"]
related: ["32-bit-alu-organization-and-control-signals", "immediate-generation-and-sign-extension-in-risc-v", "program-counter-and-instruction-memory", "main-control-and-alu-control-truth-tables"]
tags: ["beq", "jal", "pcsrc", "zero", "branch", "shift-left-1", "immgen"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-102-2.png", "/computer-architecture/assets/computer-architecture-2-page-103-2.png"]
---

## Branch and jump execution in the datapath

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 102, Page 103

Branch and jump instructions change the PC using control-flow logic rather than normal sequential execution. For a branch such as `beq rs1, rs2, offset`, the instruction is decoded to read two source registers, and `ImmGen` reconstructs the branch immediate from the instruction fields, sign-extends it, and the datapath shifts it left by 1 to produce the byte offset used in target calculation. The ALU compares the two register operands by subtraction; if `rs1 - rs2 = 0`, the ALU Zero flag becomes `1`, which serves as the equality test. In parallel, another adder computes the candidate target `PC + offset`. `PCSrc` then selects either `PC + 4` or the branch target based on the branch condition. The `jal` case is similar in target computation: `ImmGen` reconstructs the jump immediate, sign-extends it, shifts left by 1, and the datapath sets `PC = PC + offset`. In the example `jal x0, offset`, the destination is `x0`, so any write-back is effectively discarded.

### Source snapshots

![Computer Architecture-2 Page 102](/computer-architecture/assets/computer-architecture-2-page-102-2.png)

![Computer Architecture-2 Page 103](/computer-architecture/assets/computer-architecture-2-page-103-2.png)

### Page-grounded details

#### Page 102

->Case 4 : Branch instruction:

down ex/ beq rs1 , rs2 , offset

[Diagram: instruction-format box]
imm[12|10:5] | rs2 | rs1 | funct3 | imm[4:1|11] | opcode
[31-25]        [24-20] [19-15] [14-12] [11-7]      [6:0]

down The instruction memory outputs the 32-bit branch instructions

down The instruction is decoded, and the processor identifies

- rs1 (=> Read data 1)

- rs2 (=> Read data 2)

down The imgen reconstructs the branch immediate from the instruction, sign
extends it to 32 bits, and then the datapath applies a shift-left-by-1
because of how offset bytes is calculated. This will be used for address
calculation

down The ALUsource mux, to perform comparison, selects the second register
value, not the immediate

down The ALU recieves the two register values and is set to subtract. It
computes: rs1 - rs2. If the result is zero, then the two register
values were equal. So the ALU's zero output becomes the equality
test. If rs1-rs2 = 0, the zero output equals 1. if not, the
zero output equals 0 (which is a control signal).

down Data Memory is not used here and no register result is written back.
so RegWrite=0

down Meanwhile, the target address adder (adder 2) receives the curre

[Truncated for analysis]

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

### Key points

- A branch uses register comparison plus target-address calculation to decide the next PC.
- `ImmGen` reconstructs and sign-extends the branch immediate.
- The branch offset is shifted left by 1 before address calculation.
- The ALU compares `rs1` and `rs2` by subtraction.
- If subtraction yields zero, the ALU Zero flag is `1`, indicating equality.
- A separate adder computes the candidate target `PC + offset`.
- `PCSrc` chooses between `PC + 4` and the branch target.
- `jal` also reconstructs a signed immediate, shifts left by 1, and updates the PC with `PC + offset`.

### Related topics

- [[32-bit-alu-organization-and-control-signals|32-bit ALU organization and control signals]]
- [[immediate-generation-and-sign-extension-in-risc-v|Immediate generation and sign extension in RISC-V]]
- [[program-counter-and-instruction-memory|Program counter and instruction memory]]
- [[main-control-and-alu-control-truth-tables|Main control and ALU control truth tables]]

### Relationships

- depends-on: [[main-control-and-alu-control-truth-tables|Main control and ALU control truth tables]]
