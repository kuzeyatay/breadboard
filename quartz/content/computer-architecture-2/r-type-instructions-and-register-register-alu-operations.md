---
title: "R-Type Instructions and Register-Register ALU Operations"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 62", "Page 63"]
related: ["risc-v-instruction-families-and-register-naming", "shift-and-bitwise-operations-in-rv32i", "load-store-architecture-and-byte-addressable-memory", "single-cycle-processor-datapath-and-control-overview"]
tags: ["r-type", "alu", "opcode", "funct3", "funct7", "rs1", "rs2"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-062-2.png", "/computer-architecture/assets/computer-architecture-2-page-063-2.png"]
---

## R-Type Instructions and Register-Register ALU Operations

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 62, Page 63

R-type instructions are the register-register ALU instructions of RV32I. They operate on two source operands stored in registers and write a result to a destination register. The notes use `add x5, x20, x21` as the basic example corresponding to `int a = b + c` in C. The 32-bit encoding is broken into `funct7`, `rs2`, `rs1`, `funct3`, `rd`, and `opcode`. The opcode identifies the broad ALU instruction class, `rd` names the destination register, `rs1` and `rs2` name the source registers, and `funct3` plus `funct7` select the specific operation within that class, such as add versus sub. A worked example encodes `sub x22, x20, x21` and shows values 124 and 112 flowing from registers x20 and x21 into the ALU to produce 12 in x22. The notes emphasize that all R-type instructions are ALU instructions and list examples including add, sub, xor, or, and, sll, and srl.

### Source snapshots

![Computer Architecture-2 Page 62](/computer-architecture/assets/computer-architecture-2-page-062-2.png)

![Computer Architecture-2 Page 63](/computer-architecture/assets/computer-architecture-2-page-063-2.png)

### Page-grounded details

#### Page 62

1. R type (register / register)

- A Risc-V instruction operates on two source operands, and places the result
based on the instruction, in one destination operand. These operands are stored
in registers

example instruction.
                                      Instruction
                                          down
                                     add x5, x20, x21
                                      down
                             result operand (register)

[Curved arrow from `x20, x21` labeled: `source operands (registers)`]
[Arrow pointing right from the example to:] in c code: int a = b + c

√ Risc-V registers have a numeric identity x0 through x31. You
will also see names such as t0, s1, and a0. These are called ABI names,
used by software conventions, they are not a different register, it is another
label for the same physical slot.

register | ABI Name | Description
x0 | zero | Hard-wired zero value
x1 | ra | Return address
x2 | sp | Stack pointer
x3 | gp | Global pointer
x4 | tp | Thread Pointer
x5 | t0 | Temporary / Alternate link Register
x6-7 | t1-2 | Temporaries
x8 | s0 / fp | Saved register / frame pointer
x9 | s1 | Saved register
x10-11 | a0-1 | Function

[Truncated for analysis]

#### Page 63

[Top margin printed elements]
Su  Mo  Tu  We  Th  Fr  Sa

No. __________
Date      /    /

We have already said that the instructions are 32bits in RISC-V
but how does this assemble instruction, or any R format instruction, get
turned into binary? For the R format:

                               32bits
31|30|29|28|27|26|25|24|23|22|21|20|19|18|17|16|15|14|13|12|11|10|9|8|7|6|5|4|3|2|1|0
┌───────────────────┬─────────────┬─────────────┬────────┬──────────┬───────────┐
│      funct 7      │     rs2     │     rs1     │ funct3 │    rd    │  opcode   │
└───────────────────┴─────────────┴─────────────┴────────┴──────────┴───────────┘
      7 bits             5 bits        5bits       3bits    5bits      7 bits

add, or, and etc

- opcode = 7-bit binary specifying the operation, ex/ 0110011 for an ALU instruction

- rd = 5bits specifying the destination/result register. Adress number (0-31)

- funct3 = 3 bits specifying a section/subamily of the instruction type. ex/ "add/sub" section
  "or" section
  "shift-left"

- rs1 and rs2 = 5bits specifying the Source register adress numbers (0-31)

- Funct 7 = 7 bits acting as a final switch used only when a section (funct3) has two
  variants, s

[Truncated for analysis]

### Key points

- R-type instructions read two registers and write one register.
- The standard field layout is funct7, rs2, rs1, funct3, rd, opcode.
- The opcode identifies the ALU instruction class.
- funct3 and funct7 refine the exact operation, such as add versus sub.
- Source and destination register fields are 5 bits wide because there are 32 registers.
- Examples include add, sub, xor, or, and, sll, and srl.

### Related topics

- [[risc-v-instruction-families-and-register-naming|RISC-V Instruction Families and Register Naming]]
- [[shift-and-bitwise-operations-in-rv32i|Shift and Bitwise Operations in RV32I]]
- [[load-store-architecture-and-byte-addressable-memory|Load-Store Architecture and Byte-Addressable Memory]]
- [[single-cycle-processor-datapath-and-control-overview|Single-Cycle Processor Datapath and Control Overview]]

### Relationships

- part-of: [[shift-and-bitwise-operations-in-rv32i|Shift and Bitwise Operations in RV32I]]
- applies-to: [[single-cycle-processor-datapath-and-control-overview|Single-Cycle Processor Datapath and Control Overview]]
