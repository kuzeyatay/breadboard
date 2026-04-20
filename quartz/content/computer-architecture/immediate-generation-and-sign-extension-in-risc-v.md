---
title: "Immediate generation and sign extension in RISC-V"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 92", "Page 100", "Page 101", "Page 102", "Page 103"]
related: ["data-memory-interface-and-address-calculation", "datapath-and-control-partition-in-processor-design", "r-type-and-load-instruction-execution-flow", "branch-and-jump-execution-in-the-datapath", "store-instruction-execution-flow"]
tags: ["immgen", "sign-extension", "immediate", "opcode", "risc-v", "branch", "jal"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-092-2.png", "/computer-architecture/assets/computer-architecture-2-page-100-2.png"]
---

## Immediate generation and sign extension in RISC-V

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 92, Page 100, Page 101, Page 102, Page 103

The immediate generator, labeled `ImmGen`, converts the immediate bits stored inside an instruction into the actual 32-bit immediate value used by the datapath. The notes emphasize that RISC-V immediates are not all stored as full 32-bit values in the instruction; instead, they occupy fields of 12 or 20 bits depending on instruction format. Because these immediates are signed, the processor performs sign extension: if the most significant bit of the encoded immediate is `0`, the upper bits are filled with zeros; if it is `1`, the upper bits are filled with ones. `ImmGen` receives the whole instruction and uses the opcode to determine which immediate format to reconstruct. The resulting immediate is used both as an ALU operand for address calculation and arithmetic with immediates, and as an offset in branch and jump target calculation, where additional shifting may be applied for byte addressing.

### Source snapshots

![Computer Architecture-2 Page 92](/computer-architecture/assets/computer-architecture-2-page-092-2.png)

![Computer Architecture-2 Page 100](/computer-architecture/assets/computer-architecture-2-page-100-2.png)

### Page-grounded details

#### Page 92

[Top margin printed elements]
Su  Mo  Tu  We  Th  Fr  Sa
No. __________
Date ___ / ___ /

-> The adder (32 bit ripple carry adder)

- The adder is literally just 32 full adders connected. (why not 1 half-adder and 31 full adders?) -(convenience)

[Diagram]
a0, b0           a1, b1           a2, b2                              a31, b31
down                down                down                                   down
┌─────────┐      ┌─────────┐      ┌─────────┐                         ┌────────────┐
Cin -> Full
       Adder0 ─cout─ cin -> Full
                          Adder1 ─cot─ cin -> Full
                                             Adder2 ─cout── ... ──> cin -> Full
                                                                                  Adder31
└─────────┘      └─────────┘      └─────────┘                         └────────────┘
down                down                down                                   down
Sum[0]           Sum[1]           Sum[2]                              sum[31]

[Large brace/curved bracket under the chain, spanning the adders]

[Small symbol/diagram below brace]
a -> [full-adder-like shape]
b -> [same shape]
Cin labeled near upper input wit

[Truncated for analysis]

#### Page 100

down When the instruction is decoded, the processor identifies:

- rs1 = x22  (=> Read Register 1)

- rd = x9  (=> Write Register)

down The Im Gen takes the 12 bit immediate (32) field from the instruction
and sign extends it to 32 bits, so ImmGen outputs a 32-bit representation
of 32

down For a load instruction, the ALU-source mux must choose the immediate, not the
second register output. So ALUsrc selects the ImGen output

down Therefore the ALU receives : first input : contents of x22 (base address)
(0x000010000)  second input : sign extended immediate 32 (0x00000020).
The ALU is set to ADD, so it computes the effective address x22 + 32 (
0x00001000 + 0x00000020 = 0x00001020) (x22 is being used to store the starting
memory address, and the ALU takes that stored value and adds the offset to it)

down That ALU result is sent to the address input of Data Memory and since
this is a load, controls are MemRead = 1 and MemWrite = 0 so data
memory reads the word stored at address x22 + 32 and outputs it on its
Read data line.

down The MemtoReg mux (write-back mux) must now choose the memory read
data (not the ALU result)

down Then the register file receives write data = memory read

[Truncated for analysis]

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

### Key points

- `ImmGen` turns instruction immediate fields into a 32-bit value.
- Instruction immediates are typically 12 or 20 bits, not 32 bits.
- RISC-V immediates are signed.
- Sign extension fills upper bits with the sign bit of the immediate.
- `ImmGen` receives the whole instruction, not just a partial field.
- The opcode tells `ImmGen` which immediate format to generate.
- The generated immediate is used for ALU operands and for branch/jump offsets.

### Related topics

- [[data-memory-interface-and-address-calculation|Data memory interface and address calculation]]
- [[datapath-and-control-partition-in-processor-design|Datapath and control partition in processor design]]
- [[r-type-and-load-instruction-execution-flow|R-type and load instruction execution flow]]
- [[branch-and-jump-execution-in-the-datapath|Branch and jump execution in the datapath]]
- [[store-instruction-execution-flow|Store instruction execution flow]]

### Relationships

- applies-to: [[r-type-and-load-instruction-execution-flow|R-type and load instruction execution flow]]
- applies-to: [[store-instruction-execution-flow|Store instruction execution flow]]
- applies-to: [[branch-and-jump-execution-in-the-datapath|Branch and jump execution in the datapath]]
