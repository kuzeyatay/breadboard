---
title: "Program counter and instruction memory"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 94", "Page 97", "Page 98"]
related: ["datapath-and-control-partition-in-processor-design", "r-type-and-load-instruction-execution-flow", "branch-and-jump-execution-in-the-datapath", "hazards-in-pipelined-processors"]
tags: ["program-counter", "instruction-memory", "read-address", "instruction-31-0", "clock"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-094-2.png", "/computer-architecture/assets/computer-architecture-2-page-097-2.png"]
---

## Program counter and instruction memory

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 94, Page 97, Page 98

The program counter (PC) is the sequential state element that stores the 32-bit address of the next instruction to fetch. The notes describe it as a register with an implicit clock input: on an active clock edge, it loads a new value and holds it as the current PC. Instruction memory is the separate memory block that stores program instructions, each 32 bits long, and returns the instruction located at the address supplied by the PC. The notes also state that instruction memory cells are 8 bits wide, so a 32-bit instruction spans multiple bytes. In the broader datapath, the current PC is used not only to fetch the instruction but also to compute `PC + 4` for sequential execution and to participate in branch or jump target calculations. Separating instruction memory from data memory also becomes important later when avoiding structural hazards in a pipeline.

### Source snapshots

![Computer Architecture-2 Page 94](/computer-architecture/assets/computer-architecture-2-page-094-2.png)

![Computer Architecture-2 Page 97](/computer-architecture/assets/computer-architecture-2-page-097-2.png)

### Page-grounded details

#### Page 94

-> PC (Program Counter)

- The program Counter is the register that stores the 32 bit memory
address of the instruction the processor must fetch next; it tells instruction
memory where to look.

[next instruction address] -> [vertical rectangle labeled "PC"] -> [current instruction address]

down There is also an implicit clock input because PC is a sequential element, on an
active clock edge, it loads the input value and stores it as the new PC

-> Instruction Memory

- Instruction memory is the memory block that stores the program
instructions (32 bits). Its job is to provide the processor with
the instruction that must be executed next.

-> [box labeled at upper left: "Read
Address"]
inside box: "Instruction
[31 - 0]" ->

down It takes an address as input and outputs the instruction stored at that
address. In the datapath, the address comes from the PC.

down - Each "cell" is 8 bits (one byte) wide.

#### Page 97

=> Processor Design: Datapath & Control:

- A processor is easiest to understand if we split it into two cooperating
parts: (1) The datapath which performs the actual work such as addition, loading
from memory etc and is a collection of processor elements (ALU's, multiplexors etc)
(Horizontal lines / wires) (2) The control which tells the datapath elements what
to do, its the hardware that commands their control inputs. The
control hardware takes instruction information such as the opcode,
funct3, and funct7, and generates outputs such as ALU control bits,
write-enable signals for storage elements, memory read/write enables and
selector signals for multiplexors. (vertical lines / wires, blue lines)

a) Datapath

[Diagram description: a datapath block diagram with arrows showing data flow. Red lines indicate buses/major data paths; blue labels indicate control signals. Main blocks and labels, left to right/top to bottom:]

- `PC` block at far left, arrow to `read address` of `Instruction Memory`
- `Instruction Memory`
  - inside/near top: `read address`
  - inside lower area: `instruction`
  - below: `Instruction Memory`
- From instruction output to register file with field labels:

[Truncated for analysis]

#### Page 98

down The processor execution order:

1. PC supplies the address of the current instruction (32 bits).

2. Instruction Memory returns the 32-bit actual instruction at that address

3. Instruction is decoded and split

4. The register file reads the source registers named in instruction.

5. The datapath performs the instruction-specific work

6. A result is written back to a register or to memory if needed

7. The PC is updated for the next instruction

Case 1: R-Type arithmetic instruction (Check slides here)
down ex/ add x22, x20, x21

funct7      rs2      rs1      funct3      rd      opcode
0000000     10101    10100    000         10110   011011
[31-25]     [24-20]  [19-15]  [14-12]     [11-7]  [6-0]

down The PC contains the address of the current add instruction, that PC value is sent to the instruction memory, so the instruction can be fetc[unclear]
and at the same time it is also sent to the separate PC+4 adder, so the
next instruction can be prepared in parallel.

down Instruction memory reads the instruction stored at the address [unclear]
outputs the 32-bit encoding of "add x22, x20, x21"

down The instruction is then decoded, From the instruction fields, the processo[unc

[Truncated for analysis]

### Key points

- The PC stores the 32-bit address of the instruction to fetch next.
- The PC is a sequential element and updates on a clock edge.
- Instruction memory stores 32-bit program instructions.
- Instruction memory takes a read address input and outputs `Instruction[31:0]`.
- In the datapath, the PC provides the address to instruction memory.
- Instruction memory cells are 8 bits wide.
- `PC + 4` is computed in parallel for the next sequential instruction.

### Related topics

- [[datapath-and-control-partition-in-processor-design|Datapath and control partition in processor design]]
- [[r-type-and-load-instruction-execution-flow|R-type and load instruction execution flow]]
- [[branch-and-jump-execution-in-the-datapath|Branch and jump execution in the datapath]]
- [[hazards-in-pipelined-processors|Hazards in pipelined processors]]

### Relationships

- applies-to: [[r-type-and-load-instruction-execution-flow|R-type and load instruction execution flow]]
- applies-to: [[branch-and-jump-execution-in-the-datapath|Branch and jump execution in the datapath]]
