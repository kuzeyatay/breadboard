---
title: "Registers and Register Files"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 47", "Page 48", "Page 49", "Page 50"]
related: ["sequential-circuits-and-clocked-storage", "setup-time-hold-time-and-critical-path-timing", "finite-state-machines-and-the-synchronous-fsm-model", "d-latch-and-edge-triggered-d-flip-flop"]
tags: ["registers", "register-file", "d-flip-flops", "alu", "decoder", "multiplexer", "write-enable", "risc-v"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-047-2.png", "/computer-architecture/assets/computer-architecture-2-page-048-2.png"]
---

## Registers and Register Files

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 47, Page 48, Page 49, Page 50

Registers are built by placing multiple D flip-flops in parallel so that a multi-bit value, such as a byte or word, can be stored and updated together on a shared clock. A register file extends this idea into a small, fast CPU memory structure containing a fixed number of registers, each with width `W` bits. If there are `N` registers, the file stores `N` distinct `W`-bit values. The notes emphasize that a register file is not general RAM but a datapath-oriented structure designed to support instruction execution. A typical CPU instruction reads operand values from two registers and writes the result back to a destination register, so the register file commonly has two read ports and one write port. The internal implementation uses address decoding to select a target register for writing, multiplexers to choose which stored value appears at a read-data output, and synchronous write enable to control whether a write occurs on the clock edge. For `N=32` registers, the address width is `A = log_2(N) = 5` bits, matching register names `x0` through `x31`.

### Source snapshots

![Computer Architecture-2 Page 47](/computer-architecture/assets/computer-architecture-2-page-047-2.png)

![Computer Architecture-2 Page 48](/computer-architecture/assets/computer-architecture-2-page-048-2.png)

### Page-grounded details

#### Page 47

√ At a rising clock edge, DFF1 updates its output Q1 to a new stored
bit. After that, DFF1 will not change Q1. So for almost the entire
clock cycle Q1 is stable. When Q1 changes at the clock edge, that
change propagates through the combinational logic. Because each gate has delay,
the value at the input of DFF2 does not become correct immediately, it
becomes correct only after signals pass through all the gates on the path.

↳ The maximum delay through all logic gates is the worse case time it can
take for the correct value to reach DFF2's input after DFF1 launches
a change, which is called the critical path

√ Since DFF2 will sample on the next rising edge, it requires its input
to be stable for tₛᵤ seconds before that edge, meaning the computation
must finish early enough that, for the last tₛᵤ before the next edge,
DFF2's input is no longer changing

√ Therefore clock period must be at least long enough for the slowest
logic path to settle plus the setup-time margin. If else, we loose
correctness. Hold time is also a complementary constraint at the sampling
edge since DFF2's input must not change immediately after the edge for atleast
tₕ

=> Registers and Register Files:
- we ca

[Truncated for analysis]

#### Page 48

The CPU needs this structure because an instruction typically
does two things with registers : it reads values that already
exist (operands) and it writes a new value back (a result), Imagine you
have 32 small boxes inside the CPU. Each box holds a number. Those boxes are
"ex"/ In a CPU instruction like an add.                              registers x0, x1, ... , x31

add x3, x1, x2

the operands are the values currently stored in registers
x1 and x2 . The operation is "add" and the result is written
to x3

- To read a register means : Choose a register number and the register
file will output the value currently stored in that register

- To write a register means : Choose a register number Provide a
new value, and when clock edge comes, store that value into that register

- [black box representation of a register
file,]

[Diagram: a rectangular block with arrows entering from the left and one arrow entering upward from below; two arrows leave to the right. Inside the block are labels:]
Read register
number 1

Read register
number 2

write
register

write
data

write e(enable)

Read
data 1

Read in
data 2

[Left-side arrows point into: `Read register number 1`, `Read register num

[Truncated for analysis]

#### Page 49

1.c4 (same cycle) / (register file contains 32 registers so max. x31)

- Port 1 selects register 7 -> outputs value in x7
- Port 2 selects register 13 -> outputs value in x13

-> A register file read port can output the contents of one register
per cycle. A standard CPU register file therefore has two read ports
(to supply to the arithmetic logic unit (ALU))

- Write register: is the number of the register you want to overwrite
& write into x8

- Write data ; is the new value you want to put into that
register ex/ write 12

- Write (enable): is the "are we actually writing?" control bit,
usually called write enable.

↳ If Write = 1, then on the clock edge the selected
register is overwritten

↳ If Write = 0, nothing is overwritten (even if write
register data are present)

Nex/ Instruction: add x3, x1, x2   (let the current register   x1=7
                                                          x2=5
                                                          x3=999)

(1) The CPU sets the read addresses

- Read Register number 1 = 1 (select x1)
- Read register number 2 = 2 (select x2)

immediately the register file outputs

- Read data 1 = 7
- Read data 2 = 5

those two values go in

[Truncated for analysis]

#### Page 50

(2) Now the CPU prepares the writeback inputs:

- Write register = 3  (destination x3)
- Write data = 12  (the ALU result)
- Write = 1  (enable writing)

At the next rising clock edge  x3 becomes 12  (it was 99 before)

down Lets open up the black box and see the circuitry that actually
makes it work

[Diagram]
- Left input arrow labeled `adress` pointing into a box labeled:
  `address`
  `decoder`
- Output from decoder labeled `select` runs rightward across the top, then down on the right, also labeled `select`
- A downward arrow from the decoder/select line feeds the left side of a tall wedge-shaped element
- Left side input arrow into that wedge labeled:
  `wdata`
  `(write data)`
- Bottom left line labeled `command (write = 1)` leading to `enable`
- Two upward arrows from below into the register array area labeled:
  `clk, reset`
- Center register array has three rows labeled on the right:
  `word0`
  `word1`
  `word2`
- Above the top row: `bit2   bit1   bit0`
- Top row boxes:
  `FF02`   `FF01`   `FF00`
- Middle row boxes:
  `FF12`   `FF01`   `FF09`
- Bottom row boxes:
  `FF02`   `FF01`   `FF00`
- On the right, a mux-like wedge labeled vertically:
  `3`
  `2`
  `x`
- Output arr

[Truncated for analysis]

### Key points

- A register is an array of D flip-flops storing a multi-bit datum in parallel.
- A register file stores `N` registers each of width `W` bits.
- CPU instructions commonly read two operands and write one result.
- A standard CPU register file therefore has two read ports and one write port.
- Read ports output the contents of selected registers.
- Writes occur on a clock edge when write enable is asserted.
- Address width is `A = log_2(N)`; for 32 registers, `A = 5` bits.
- A decoder selects write targets and a multiplexer selects read outputs.

### Related topics

- [[sequential-circuits-and-clocked-storage|Sequential Circuits and Clocked Storage]]
- [[setup-time-hold-time-and-critical-path-timing|Setup Time, Hold Time, and Critical Path Timing]]
- [[finite-state-machines-and-the-synchronous-fsm-model|Finite State Machines and the Synchronous FSM Model]]
- [[d-latch-and-edge-triggered-d-flip-flop|D Latch and Edge-Triggered D Flip-Flop]]

### Relationships

- depends-on: [[d-latch-and-edge-triggered-d-flip-flop|D Latch and Edge-Triggered D Flip-Flop]]
- limits: [[setup-time-hold-time-and-critical-path-timing|Setup Time, Hold Time, and Critical Path Timing]]
