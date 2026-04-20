---
title: "Datapath and control partition in processor design"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 97"]
related: ["32-bit-alu-organization-and-control-signals", "program-counter-and-instruction-memory", "register-file-ports-and-d-latch-foundation", "main-control-and-alu-control-truth-tables"]
tags: ["datapath", "control", "alusrc", "memtoreg", "pcsrc", "bus", "aluop"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-097-2.png"]
---

## Datapath and control partition in processor design

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 97

The notes explain processor design by separating it into datapath and control. The datapath is the collection of hardware elements that move and transform data, including the PC, instruction memory, register file, immediate generator, ALU, adders, data memory, and multiplexers. The control unit interprets instruction fields such as `opcode`, `funct3`, and `funct7`, and drives the datapath by generating control outputs like ALU control bits, write enables, memory read/write signals, and mux selectors. The major datapath diagram traces how the PC feeds instruction memory, how instruction fields choose source and destination registers, how `ImmGen` feeds immediate operands, how the ALU either computes a result or an address, how data memory participates in loads/stores, and how the write-back mux returns either ALU or memory data to the register file. The notes also clarify that the wide red lines are buses rather than single wires, and that some narrower paths carry 5-bit register addresses.

### Source snapshots

![Computer Architecture-2 Page 97](/computer-architecture/assets/computer-architecture-2-page-097-2.png)

### Page-grounded details

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

### Key points

- A processor is split into a datapath and a control unit.
- The datapath performs operations such as addition, address calculation, and memory access.
- The control unit tells datapath elements what to do by driving their control inputs.
- Control uses instruction information such as `opcode`, `funct3`, and `funct7`.
- The datapath includes PC, instruction memory, register file, `ImmGen`, ALU, data memory, adders, and muxes.
- The write-back path returns either the ALU result or memory read data to the register file.
- Red wide paths in the diagram represent 32-wire buses rather than single wires.
- Five-bit wires are routed separately for register-address inputs.

### Related topics

- [[32-bit-alu-organization-and-control-signals|32-bit ALU organization and control signals]]
- [[program-counter-and-instruction-memory|Program counter and instruction memory]]
- [[register-file-ports-and-d-latch-foundation|Register file ports and D-latch foundation]]
- [[main-control-and-alu-control-truth-tables|Main control and ALU control truth tables]]

### Relationships

- depends-on: [[main-control-and-alu-control-truth-tables|Main control and ALU control truth tables]]
