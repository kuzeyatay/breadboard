---
title: "Jump and Link, JALR, and Function Return Mechanics"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 72"]
related: ["branch-instructions-and-pc-relative-control-flow", "functions-calling-convention-and-argument-passing", "leaf-and-non-leaf-procedures-with-stack-discipline"]
tags: ["j-type", "jal", "jalr", "return-address", "pc-4", "offset"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-072-2.png"]
---

## Jump and Link, JALR, and Function Return Mechanics

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 72

Unconditional control transfer in RISC-V is handled by jump instructions. The notes present J-type `jal` for unconditional jump-and-link, used in loops and function calls. `jal x1, label` stores the address of the next instruction in x1, which is ABI register `ra`, then jumps to the target. A worked example shows a `jal` at address 100 storing 104 into x1 before transferring control to label `L1` at address 200. The J-type encoding is `imm[20] | imm[10:1] | imm[11] | imm[19:12] | rd | opcode`, and like branches it uses a PC-relative offset, but with a larger reach of about ±1 MB according to the notes. The pages then distinguish `jalr`, which is not J-type and instead uses the I-type layout. `jalr x0, 0(x1)` jumps to the address held in x1 and discards the link value because rd is x0. This is the standard return pattern from a function: jump back to `ra` without saving a new return address.

### Source snapshots

![Computer Architecture-2 Page 72](/computer-architecture/assets/computer-architecture-2-page-072-2.png)

### Page-grounded details

#### Page 72

=> J-type (jump)

- A J-type instruction exists because programs also need unconditional control
transfer: jumping to another block without a condition, implementing
loops, and calling functions.

J ex/

jump and link
address of next instruction
jal   x1, label   // go to label
      x1
      w- ra in ABI (return address)

[Curved arrow from "address of next instruction" / `jal x1, label` to worked example at right.]

ex/ e.
100: jal x1, L1   (1)
104: addi t0, t0, 1
...
200 L1: sub a0, a1, a2

[Arrow downward from `200 L1: sub a0, a1, a2` to note.]

when the processor
executes (1), it adds
100, it puts "104" into
x1, because 104 is the
next instruction
after the call

1    10    1    8    5    7
imm[20] | imm[10:1] | imm[11] | imm[19:12] | rd | opcode

rd = x1 = PC+4

b the label offset is calculated the same way as we did in branch
but immediate is larger (can place them more apart) (±1mb reach). Thus
after rd issue new PC = old PC + offset bytes

[Blue scribbled-out highlighted region.]

[Arrow from the blue scribble / nearby note to text:]
-> Is NOT J-type, uses the I type format

J ex/
jalr   x0, 0(x1)   // Jump to the address in x1 (ra), and do not
save a new return address (b

[Truncated for analysis]

### Key points

- J-type provides unconditional control transfer.
- `jal rd, label` saves `PC+4` in `rd` and then jumps to the label.
- The ABI convention uses `ra` (x1) for the return address.
- J-type immediate reach is larger than branch reach.
- `jalr` uses I-type format rather than J-type.
- `jalr x0, 0(ra)` is the standard return sequence.

### Related topics

- [[branch-instructions-and-pc-relative-control-flow|Branch Instructions and PC-Relative Control Flow]]
- [[functions-calling-convention-and-argument-passing|Functions, Calling Convention, and Argument Passing]]
- [[leaf-and-non-leaf-procedures-with-stack-discipline|Leaf and Non-Leaf Procedures with Stack Discipline]]

### Relationships

- depends-on: [[functions-calling-convention-and-argument-passing|Functions, Calling Convention, and Argument Passing]]
