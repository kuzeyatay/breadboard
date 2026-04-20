---
title: "Register file ports and D-latch foundation"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 95", "Page 96"]
related: ["program-counter-and-instruction-memory", "r-type-and-load-instruction-execution-flow", "store-instruction-execution-flow", "datapath-and-control-partition-in-processor-design"]
tags: ["register-file", "regwrite", "rs1", "rs2", "d-latch"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-095-2.png", "/computer-architecture/assets/computer-architecture-2-page-096-2.png"]
---

## Register file ports and D-latch foundation

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 95, Page 96

The register file is the processor's small, fast internal storage block holding architectural registers such as `x0` through `x31` in RISC-V. The notes show that it supports two simultaneous reads and one write, which is necessary because many instructions need two source operands and one destination. The selection inputs are `Read Register number 1`, `Read Register number 2`, and `Write register`, while `Write data` carries the value to store and `RegWrite` decides whether a write occurs. The outputs `Read data1` and `Read data2` are the actual 32-bit register contents. Since there are 32 registers, register identifiers are 5 bits wide, which explains the size of the `rs1`, `rs2`, and `rd` fields in instructions. The notes also emphasize the special behavior of `x0`, which always reads as zero and ignores writes. At the circuit level, the page ties storage to latches by sketching a D-latch implementation using NAND gates and clocking.

### Source snapshots

![Computer Architecture-2 Page 95](/computer-architecture/assets/computer-architecture-2-page-095-2.png)

![Computer Architecture-2 Page 96](/computer-architecture/assets/computer-architecture-2-page-096-2.png)

### Page-grounded details

#### Page 95

-> Register file

- The register file is the hardware block inside the processor that stores
the CPU's small set of working registers, such as x0 to x31, in RISC-V.
its a fast internal storage unit used to hold values that instructions need
immediately, such as operands for the ALU, addresses for memory access
and destinations for computation results. It is small and fast.

[Diagram]
Left block with four input arrows from the left and two output arrows to the right:
- "Read Register
  number 1"
- "Read Register
  number 2"
- "Write register"
- "Write
  data  Write?"
Outputs on right side:
- "Read
  data1"
- "Read
  data2"
Arrow from below into the block:
- "RegWrite"

Arrow pointing right from this block to a larger register-file structure.

Above the larger structure:
- "address"
Arrow into small box:
- "address
  decoder"
Label on line from decoder across top:
- "select"

Large structure labels:
- top row: "bit0    bit1    ....    bit31"
- right side rows: "Word 0", "Word1", "Word31"

Inside bit cells:
- Row for Word 0: "FF00", "FF01", "FF31"
- Row for Word 1: "FF04", "FF0.1", "FF31"
- Bottom row: "FF00", "FF01", "FF31"

Left side input into large structure:
- "Write
  Data"
Arro

[Truncated for analysis]

#### Page 96

down In the RISC-V datapath, the register file contains 32 registers, each
32 bits wide. Since there are 32 registers, a register number needs
5 bits (because 2^5 = 32). That is why instruction fields like rs1, rs2 and
rd are 5 bits long

down

The register file has two read ports and one write port. The two read
ports are needed because many instructions need two source operands at the
same time. (ex: add). The actual input channels are named Read Register1
and Read Register2 and Write Register, which are the register numbers
selecting which registers to access. There is also Write data, which is
the value that may be written into the destination register, and RegWrite,
the control signal telling the register file whether writing should
happen. The outputs are Read data1 and Read data 2, which
are the actual 32 bit values stored in the selected source registers

! One special Register in RISC-V is x0, which is always zero. It
behaves as a constant zero source and ignores writes

↔ The D latch is also can implemented by NAND gates as follows

[Diagram: NAND-gate latch diagram]
- Left labels: `D`, `CLK`, `R`
- `CLK` line branches downward through an inverter to `R`
- `D` feeds the u

[Truncated for analysis]

### Key points

- The register file stores the processor's working registers such as `x0` to `x31`.
- It is small and fast compared with data memory.
- The register file has two read ports and one write port.
- The selector inputs are register numbers, while outputs are 32-bit data values.
- Because there are 32 registers, register numbers are 5 bits wide.
- `rs1`, `rs2`, and `rd` are therefore 5-bit instruction fields.
- `x0` is a special register that always reads as zero and ignores writes.
- The notes also show a D-latch implemented using NAND gates.

### Related topics

- [[program-counter-and-instruction-memory|Program counter and instruction memory]]
- [[r-type-and-load-instruction-execution-flow|R-type and load instruction execution flow]]
- [[store-instruction-execution-flow|Store instruction execution flow]]
- [[datapath-and-control-partition-in-processor-design|Datapath and control partition in processor design]]

### Relationships

- applies-to: [[r-type-and-load-instruction-execution-flow|R-type and load instruction execution flow]]
- applies-to: [[store-instruction-execution-flow|Store instruction execution flow]]
