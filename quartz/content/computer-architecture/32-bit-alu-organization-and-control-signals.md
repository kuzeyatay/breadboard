---
title: "32-bit ALU organization and control signals"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 89"]
related: ["full-adder-and-half-adder-construction", "32-bit-ripple-carry-adder", "datapath-and-control-partition-in-processor-design", "branch-and-jump-execution-in-the-datapath"]
tags: ["alu", "ainvert", "bnegate", "zero", "overflow", "carry-out", "slt"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-089-2.png"]
---

## 32-bit ALU organization and control signals

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 89

The notes describe the ALU as a 32-bit structure built from 32 one-bit ALU cells connected together. Each cell contains arithmetic hardware based on a full adder, logic-operation hardware, and selection/control logic. The ALU supports bitwise operations such as AND and OR, arithmetic operations such as add and subtract, and comparison such as `slt`. In instruction execution, the ALU is not only used for R-type arithmetic but also for address calculation in `lw` and `sw`, where it adds a base register to a sign-extended offset, and for branch comparison in `beq` and `bne`, where it subtracts two operands and examines the Zero output. The diagrams also highlight control inputs such as `Ainvert`, `bnegate`, and operation bits that determine whether operands are inverted and which result function is selected. The final ALU block exports `Result`, `zero`, `overflow`, and `Carry Out`, making it both a computation unit and a source of status information for control decisions.

### Source snapshots

![Computer Architecture-2 Page 89](/computer-architecture/assets/computer-architecture-2-page-089-2.png)

### Page-grounded details

#### Page 89

- The ALU

- The ALU is made up of 32 one-bit ALU cells. Each cell contains
  full-adder ([unclear] arithmetic hardware) plus logic operation hardware
  plus selection / control logic. The ALU supports instructions such as:

  - Bitwise operations              - Arithmetic Operations           - Comparison
    ↳ And                            ↳ ADD                            ↳ slt (set on less than)
    ↳ OR                             ↳ s.b
                                     ↳ Multiplication
                                     ↳ Division

down Instruction-wise ALU performs R-type arithmetic instructions, and aids
with: Load and Store instructions! (for lw and sw, the ALU is used to add the
base register and the sign-extend offset to form the effective memory address), and
Branch instructions (for beq and bne, the ALU is used to subtract the two
register operands and check the Zero output of the ALU for comparison)

down ex/ ALU with AND, OR, add and subtract operations (only these operations)

            bnegate     pcontrol          Operation
Ainvert
  down
[diagram of stacked 1-bit ALU cells connected vertically and by carry lines]

Top cell:
- inputs labeled `a0`, `b0`
- in

[Truncated for analysis]

### Key points

- The ALU is built from 32 one-bit ALU cells.
- Each ALU cell combines a full adder, logic hardware, and control/selection logic.
- Supported operations include AND, OR, add, subtract, multiplication, division, and comparison such as `slt`.
- For `lw` and `sw`, the ALU computes effective addresses by adding base register and sign-extended offset.
- For `beq` and `bne`, the ALU subtracts the two register operands and uses the Zero output for comparison.
- `bnegate` makes a cell use `b̅i` instead of `bi`, enabling subtraction behavior.
- `Ainvert` makes a cell use `āi` instead of `ai`.
- The ALU block outputs `Result`, `zero`, `overflow`, and `Carry Out`.

### Related topics

- [[full-adder-and-half-adder-construction|Full adder and half adder construction]]
- [[32-bit-ripple-carry-adder|32-bit ripple-carry adder]]
- [[datapath-and-control-partition-in-processor-design|Datapath and control partition in processor design]]
- [[branch-and-jump-execution-in-the-datapath|Branch and jump execution in the datapath]]

### Relationships

- depends-on: [[full-adder-and-half-adder-construction|Full adder and half adder construction]]
- depends-on: [[32-bit-ripple-carry-adder|32-bit ripple-carry adder]]
- applies-to: [[branch-and-jump-execution-in-the-datapath|Branch and jump execution in the datapath]]
