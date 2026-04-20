---
title: "Shift and Bitwise Operations in RV32I"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 64"]
related: ["r-type-instructions-and-register-register-alu-operations", "risc-v-assembly-programming-patterns-and-pseudoinstructions", "branch-instructions-and-pc-relative-control-flow"]
tags: ["sll", "srl", "sra", "mask", "bitwise", "twos-complement"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-064-2.png"]
---

## Shift and Bitwise Operations in RV32I

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 64

The notes single out shifts and bitwise masking as core ALU operations. Logical left shift `sll` moves each bit toward the most significant bit and inserts 0 at the least significant bit. The page illustrates 23 becoming 46 when shifted left by one position and notes that left shift by 1 is equivalent to multiplying by 2 if overflow beyond 32 bits is ignored. Logical right shift `srl` moves bits toward the least significant bit and inserts 0 at the most significant bit; the notes illustrate 23 becoming 11 when shifted right by one, which corresponds to unsigned division by 2 with remainder discarded. Arithmetic right shift `sra` is distinguished from `srl` because it preserves the sign of two's-complement negative numbers. The page also introduces bitwise AND as a masking operation: a mask contains 1s in positions to keep and 0s in positions to clear. The worked example ANDs `0011 1100 0000 0000` with `0000 1101 1100 0000` to obtain `0000 1100 0000 0000`.

### Source snapshots

![Computer Architecture-2 Page 64](/computer-architecture/assets/computer-architecture-2-page-064-2.png)

### Page-grounded details

#### Page 64

/ex/ Shift left (sll) : a Shift left moves every bit in a register left by
some amount.

MSB                                      LSB
[diagram: top row of 8 bit boxes labeled `0 0 0 1 0 1 1 1`; arrows point down-left/down to a second row of 8 bit boxes labeled `0 0 1 0 1 1 1 0`; a boxed `0` is drawn entering at the right side / LSB end.]

(23 becomes 46 by shifting 1 left)

-> when you shift left logically by 1, every
bit moves one position towards the MSB, and
a 0 enters at the LSB. In binary, shifting
left by 1 is equivalent to multiplying by 2,
as long as you ignore overflow beyond 32 bits.
ex/

- sll rd, rs1, rs2 shifts rs1 left by the amount in rs2

/ex/Shift right (srl) : a Shift right moves every bit in a register by
some amount.

[diagram: top row of 8 bit boxes labeled `0 0 0 1 0 1 1 1`; arrows point down-right/down to a second row of 8 bit boxes labeled `0 0 0 0 1 0 1 1`; a boxed `0` is drawn entering at the left side / MSB end.]

(23 becomes 11 by shifting 1 right)

-> when you shift right, bits move toward
LSB and a 0' enters at the MSB. For
an unsigned interpretation, shifting right
by 1 is like dividing by 2 and discarding
the remainder

- Srl rd, rs1, rs2 shifts rs1

[Truncated for analysis]

### Key points

- Logical left shift inserts 0 at the LSB and moves bits toward the MSB.
- Left shift by 1 corresponds to multiply-by-2 when overflow is ignored.
- Logical right shift inserts 0 at the MSB and moves bits toward the LSB.
- Unsigned right shift by 1 corresponds to divide-by-2 with remainder discarded.
- Arithmetic right shift preserves the sign of negative two's-complement values.
- Bitwise AND supports masking operations.
- A mask keeps positions with 1s and clears positions with 0s.

### Related topics

- [[r-type-instructions-and-register-register-alu-operations|R-Type Instructions and Register-Register ALU Operations]]
- [[risc-v-assembly-programming-patterns-and-pseudoinstructions|RISC-V Assembly Programming Patterns and Pseudoinstructions]]
- [[branch-instructions-and-pc-relative-control-flow|Branch Instructions and PC-Relative Control Flow]]

### Relationships

- applies-to: [[risc-v-assembly-programming-patterns-and-pseudoinstructions|RISC-V Assembly Programming Patterns and Pseudoinstructions]]
