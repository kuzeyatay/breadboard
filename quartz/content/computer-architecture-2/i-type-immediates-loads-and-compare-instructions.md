---
title: "I-Type Immediates, Loads, and Compare Instructions"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 65", "Page 66"]
related: ["load-store-architecture-and-byte-addressable-memory", "s-type-stores-and-memory-update-examples", "risc-v-assembly-programming-patterns-and-pseudoinstructions", "single-cycle-processor-datapath-and-control-overview"]
tags: ["i-type", "immediate", "addi", "andi", "slti", "sltiu", "jalr"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-065-2.png", "/computer-architecture/assets/computer-architecture-2-page-066-2.png"]
---

## I-Type Immediates, Loads, and Compare Instructions

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 65, Page 66

The I-type format is the standard way in RV32I to combine a register with a small constant embedded directly in the instruction. Its field layout is `imm[11:0] | rs1 | funct3 | rd | opcode`, where the immediate is a 12-bit two's-complement value. The notes explain three uses of the format: immediate ALU operations, loads, and certain comparisons or jumps such as `slti`, `sltiu`, and `jalr`. Immediate ALU examples include `andi t0, t1, 0xFF00` and `addi x22, x22, 4`. For loads, the effective address is formed by adding the signed immediate offset to a base register. The example `lw x9, 32(x22)` loads a word from memory at address `x22 + 32`, and the page gives the binary encoding for the fields. A worked compilation example translates `g = h + A[1]` into `lw t0, 4(x22)` followed by `add x20, x21, t0`, using the fact that each word in the array occupies 4 bytes.

### Source snapshots

![Computer Architecture-2 Page 65](/computer-architecture/assets/computer-architecture-2-page-065-2.png)

![Computer Architecture-2 Page 66](/computer-architecture/assets/computer-architecture-2-page-066-2.png)

### Page-grounded details

#### Page 65

- RV32I is a load/store architecture, the CPU can only perform
arithmetic and logic operations on values that are already inside the
register file. Meanwhile, most program data such as: some variables,
arrays, structures live in main memory, which is much larger but slower
thus, any realistic program repeatedly loads a value from memory
into a register, computes using register only ALU instructions, and stores
the result back into the ALU when needed

down Another important fact is that RV32 memory is byte-addressable meaning
a memory address names a single 8 bit byte. Even though CPU often
transfers 32 bits at once, addresses still count in bytes: address 0,1,2,3
refer to four consecutive bytes. The CPU reads 4 consecutive bytes to
get a single stored word, because a word is 32 bits.

[diagram: vertical stack of four memory cells bracketed together as "word 0"; dots above and below indicate continuation]
0x00000007    base
0x00000006    base+1
0x00000005    base+2
0x00000004    base+3

-> Because the adress space is byte
indexed, the start addresses of
consecutive words differ by 4.

↳ Word 0 starts at base
↳ word 1 starts at base+4
↳ word 2 starts at base+8 ...

I type Format

31

[Truncated for analysis]

#### Page 66

The second use is **loads**. The data transfer instruction that copies
data from memory to a register is called load.

down ex/
`lw  x9  32(x22)`
(load word)
              down
         adress offset
      (constant = immediate)
                        ↘ base adress.

down ex/ Assume that A is an array of 5 words and that the compiler has associated
the variables g and h with the registers x20 an x21 as before. Assume
the base adress of the array is in x22. Compile this C statement

`g = h + A[1]`

down Solution:
             temp variable          base adress
`lw  t0,  4(x22)`
           ↳ offset constant

`add  x20,  x21,  t0`

down ex/
`lw  x9  32(x22)`

| address ofset | rs1 | funct3 | rd | opcode |
|---|---|---|---|---|
| `000000100000` | `10110` | `010` | `01001` | `0000011` |

down under `address ofset`:
adress ofset
(32 in binary)

down under `rs1`:
22 in binary

down under `funct3`:
funct3
for lw
(2 in binary)

down under `rd`:
9 in binary

down under `opcode`:
Operation code
for load type

down the third are some conditions

down ex/                              -> (R-format)
`slt  x5, x6, x7`   =>   if (x6 < x7) {x5 = 1} else {x5 = 0}

down `slti  t0, s0, 25`     immedia

[Truncated for analysis]

### Key points

- I-type uses a 12-bit two's-complement immediate.
- The field layout is imm, rs1, funct3, rd, opcode.
- Immediate ALU instructions combine one register with a constant.
- Load instructions also use I-type and compute address = base + offset.
- The load word instruction `lw` reads a 32-bit word from memory into a register.
- Compare-immediate instructions include `slti` and unsigned `sltiu`.

### Related topics

- [[load-store-architecture-and-byte-addressable-memory|Load-Store Architecture and Byte-Addressable Memory]]
- [[s-type-stores-and-memory-update-examples|S-Type Stores and Memory Update Examples]]
- [[risc-v-assembly-programming-patterns-and-pseudoinstructions|RISC-V Assembly Programming Patterns and Pseudoinstructions]]
- [[single-cycle-processor-datapath-and-control-overview|Single-Cycle Processor Datapath and Control Overview]]

### Relationships

- related: [[s-type-stores-and-memory-update-examples|S-Type Stores and Memory Update Examples]]
- applies-to: [[single-cycle-processor-datapath-and-control-overview|Single-Cycle Processor Datapath and Control Overview]]
