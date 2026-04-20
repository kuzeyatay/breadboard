---
title: "RISC-V Instruction Families and Register Naming"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 61", "Page 62"]
related: ["instruction-set-architecture-rv32i-registers-and-memory-basics", "r-type-instructions-and-register-register-alu-operations", "functions-calling-convention-and-argument-passing", "i-type-immediates-loads-and-compare-instructions", "s-type-stores-and-memory-update-examples", "branch-instructions-and-pc-relative-control-flow", "jump-and-link-jalr-and-function-return-mechanics"]
tags: ["risc-v", "rv32i", "r-type", "i-type", "s-type", "b-type", "j-type", "abi"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-061-2.png", "/computer-architecture/assets/computer-architecture-2-page-062-2.png"]
---

## RISC-V Instruction Families and Register Naming

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 61, Page 62

The ISA overview is refined into two linked ideas: the essential instruction families that any practical ISA must provide, and the naming of architectural registers used by RISC-V software conventions. The notes say an ISA must support arithmetic and logical operations, memory access, and control flow for loops and conditionals. These needs lead to six instruction formats in RV32I: R-type, I-type, S-type, B-type, J-type, and U-type. A later page explains that registers have both numeric names x0 through x31 and ABI names such as zero, ra, sp, s0, a0, and t0. These ABI names are not different registers; they are software-convention labels for the same physical register slots. The register-role table identifies the intended use of each class: x0 is hard-wired zero, x1 is the return address, x2 is the stack pointer, a0-a7 are arguments and return values, s-registers are saved across calls, and t-registers are temporaries.

### Source snapshots

![Computer Architecture-2 Page 61](/computer-architecture/assets/computer-architecture-2-page-061-2.png)

![Computer Architecture-2 Page 62](/computer-architecture/assets/computer-architecture-2-page-062-2.png)

### Page-grounded details

#### Page 61

- An ISA is built around the physical reality of a CPU and its
memory system. To run real programs, an ISA must offer instructions
classified into a few essential families, based on the CPU.

1) It must include instructions for Arithmetic and logical instructions

2) It must include instructions on how to access values inside Memory,

3). It must include instructions to define control flow such as loops,
conditionals etc

These ideas lead to 6 instruction formats/types:

1. R-type (register-register ALU)

2. I-type (immediate / loads / jalr)

3. S-type (stores)

4. B-type (branches)

5. J-type (Jump)

6. U-type (upper immediate)

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

### Key points

- A useful ISA must include ALU operations, memory access, and control-flow instructions.
- RV32I uses six instruction formats: R, I, S, B, J, and U.
- Registers x0-x31 are the architectural register identities.
- ABI names are aliases for the same physical registers.
- x0 is hard-wired to zero.
- x1 is ra, the return address register.
- x2 is sp, the stack pointer.
- a0-a7 carry arguments and return values; s-registers are saved; t-registers are temporaries.

### Related topics

- [[instruction-set-architecture-rv32i-registers-and-memory-basics|Instruction Set Architecture, RV32I, Registers, and Memory Basics]]
- [[r-type-instructions-and-register-register-alu-operations|R-Type Instructions and Register-Register ALU Operations]]
- [[functions-calling-convention-and-argument-passing|Functions, Calling Convention, and Argument Passing]]
- [[i-type-immediates-loads-and-compare-instructions|I-Type Immediates, Loads, and Compare Instructions]]
- [[s-type-stores-and-memory-update-examples|S-Type Stores and Memory Update Examples]]
- [[branch-instructions-and-pc-relative-control-flow|Branch Instructions and PC-Relative Control Flow]]
- [[jump-and-link-jalr-and-function-return-mechanics|Jump and Link, JALR, and Function Return Mechanics]]

### Relationships

- part-of: [[r-type-instructions-and-register-register-alu-operations|R-Type Instructions and Register-Register ALU Operations]]
- part-of: [[i-type-immediates-loads-and-compare-instructions|I-Type Immediates, Loads, and Compare Instructions]]
- part-of: [[s-type-stores-and-memory-update-examples|S-Type Stores and Memory Update Examples]]
- part-of: [[branch-instructions-and-pc-relative-control-flow|Branch Instructions and PC-Relative Control Flow]]
- part-of: [[jump-and-link-jalr-and-function-return-mechanics|Jump and Link, JALR, and Function Return Mechanics]]
