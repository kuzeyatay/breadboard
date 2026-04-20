---
title: "Branch Instructions and PC-Relative Control Flow"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 69", "Page 70", "Page 71"]
related: ["shift-and-bitwise-operations-in-rv32i", "jump-and-link-jalr-and-function-return-mechanics", "risc-v-assembly-programming-patterns-and-pseudoinstructions", "single-cycle-processor-datapath-and-control-overview"]
tags: ["b-type", "beq", "bne", "blt", "bge", "program-counter", "pc-relative", "offset"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-069-2.png", "/computer-architecture/assets/computer-architecture-2-page-070-2.png"]
---

## Branch Instructions and PC-Relative Control Flow

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 69, Page 70, Page 71

B-type instructions provide conditional control transfer in RISC-V. Their purpose is to let the CPU sometimes stop executing the next sequential instruction and continue from another location. The encoding splits the branch immediate across several fields: `imm[12] | imm[10:5] | rs2 | rs1 | funct3 | imm[4:1] | imm[11] | opcode`. The notes explain that labels such as `lbl` are converted by the assembler into signed PC-relative offsets using `offset_bytes = Target - PC`. Since instructions are 4 bytes and memory is byte-addressable, the program counter normally advances by 4 after each instruction. Branch offsets are stored in halfword units, so the low bit of the true byte offset is always zero and is not stored explicitly. The pages work through an example where a branch at PC = 4 targets address 12, producing an offset of 8 bytes. The notes also give a compilation pattern for `if/else`, where a conditional branch skips to `Else`, the true block executes, and an unconditional branch jumps to `Exit`. Additional branch variants include `blt`, `bge`, `bltu`, and `bgeu`.

### Source snapshots

![Computer Architecture-2 Page 69](/computer-architecture/assets/computer-architecture-2-page-069-2.png)

![Computer Architecture-2 Page 70](/computer-architecture/assets/computer-architecture-2-page-070-2.png)

### Page-grounded details

#### Page 69

-> **B type (conditional Branches)**

- A B type instruction exists for one reason: it is the mechanism that
lets the CPU sometimes stop executing "the next instruction" and instead continue
from a different point in code

31|30|29|28|27|26|25|24|23|22|21|20|19|18|17|16|15|14|13|12|11|10|9|8|7|6|5|4|3|2|1|0
imm[12] | imm[10:5] | rs2 | rs1 | funct3 | imm[4:1] | imm[11] | opcode

down ex/
  beq s0, s1, lbl  // if(a == b) goto lbl
              s0 s1

branch is equal

         immediate

  bne s0, s1, lbl1  // if(a =! b) goto lbl1
              s0 s1

branch is not equal

↳ Lbl1 or any label when using B type instructions is stored as a
two's complement number based on

offset_bytes = Target - PC

down After assembly/compilation, the instructions become bits that are placed
in instruction memory (or in RAM/flash). Since memory is byte addressable, every
byte has an address. Since each instruction is 32 bits (4 bytes) each
instruction occupies 4 consecutive byte addresses. The CPU has a register
called the program counter(PC) that holds an address in instruction
memory.

down ex/ if PC = 04, the CPU will fetch the 4 bytes at addresses 0x04, 0x05, 0x06, 0x07
   (0x00000004)
and interpre

[Truncated for analysis]

#### Page 70

"lex"

PC -> 04          bne s0, s1, lbl1
     08          :
     12     lbl1: .... // command to execute if s0 != s1

offset_bytes = Target - PC = 12 - 4 = 8 bytes
                     down can be negative; is label is before the target

8 in binary: 0000 0000 1000

immediate:    0000 0000 100x
up "x" is zero's complement

[Diagram: arrows from the bits of `0000 0000 100x` point down into a branch-format instruction field box.]

| imm[12] | imm[10:5] | rs2 | rs1 | funct3 | imm[4:1] | imm[11] | opcode |

[Brace/arrow note to the right of the bit layout:]
Branch targets are specified in "halfword (2 bytes) units", so the true byte offset is always a multiple of 2, meaning its LSB is always 0. So RISC-V doesn't store the last bit, effectively making the stored immediate in half words.

! when you allocate 12 bits to a signed branch of set and you measure it in halwords,
the offset_bytes can be at max ±2048 halfwords from the branch instruction. thats
about 1024 instructions away.

             +2^11-1 halfwords
current instruction
             -2^11 halfwords

down if the else is further away than can be
expressed in 11 immediate bits, the assembler
inserts an unconditional jump (wil

[Truncated for analysis]

#### Page 71

down Key compile the c code

if (i==j)
    f = g - h
else
    f = g + h

with f, g, h, i, j loaded as S0, S1, S2, S3, S4, respectively.

down Solution:
    bne S3, S4, Else
    sub S0, S1, S2
    beq x0, x0 Exit
Else: add S0, S1, S2
Exit:

down More:
    -> (branch lower than)
- blt    (Branch < )

    -> (branch greater than)
- bge    (Branch >= )

- bltu   (Branch < (u))    unsigned

- bgeu   (Branch >= (u) )

### Key points

- B-type implements conditional branches.
- Branch targets are encoded as signed PC-relative offsets.
- The assembler computes `offset_bytes = Target - PC`.
- The PC normally updates by `PC = PC + 4` after sequential execution.
- Branch immediates are stored in halfword units, so the least significant bit is omitted.
- If a destination is too far, the assembler can invert the condition and insert an unconditional jump.
- Common branch mnemonics include `beq`, `bne`, `blt`, `bge`, `bltu`, and `bgeu`.

### Related topics

- [[shift-and-bitwise-operations-in-rv32i|Shift and Bitwise Operations in RV32I]]
- [[jump-and-link-jalr-and-function-return-mechanics|Jump and Link, JALR, and Function Return Mechanics]]
- [[risc-v-assembly-programming-patterns-and-pseudoinstructions|RISC-V Assembly Programming Patterns and Pseudoinstructions]]
- [[single-cycle-processor-datapath-and-control-overview|Single-Cycle Processor Datapath and Control Overview]]

### Relationships

- contrasts-with: [[jump-and-link-jalr-and-function-return-mechanics|Jump and Link, JALR, and Function Return Mechanics]]
- applies-to: [[risc-v-assembly-programming-patterns-and-pseudoinstructions|RISC-V Assembly Programming Patterns and Pseudoinstructions]]
- applies-to: [[single-cycle-processor-datapath-and-control-overview|Single-Cycle Processor Datapath and Control Overview]]
