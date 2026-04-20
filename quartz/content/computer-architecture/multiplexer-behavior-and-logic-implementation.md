---
title: "Multiplexer behavior and logic implementation"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 91"]
related: ["32-bit-alu-organization-and-control-signals", "datapath-and-control-partition-in-processor-design", "r-type-and-load-instruction-execution-flow", "branch-and-jump-execution-in-the-datapath"]
tags: ["multiplexer", "mux", "select-line", "alusrc", "memtoreg"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-091-2.png"]
---

## Multiplexer behavior and logic implementation

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 91

The multiplexer is introduced as a core datapath selection element that chooses one of several inputs and forwards it to a single output according to a control signal called the select line. The notes emphasize that a mux behaves like a hardware if-then-else. For a 2-input mux, there are two data inputs and one selector; the selector determines which input becomes the output. The truth table on the page makes the rule explicit: when `S = 0`, the output equals one data input, and when `S = 1`, the output equals the other. The logic implementation shown uses two AND gates and one OR gate, with the select signal inverted on one branch so that exactly one data path is enabled at a time. This building block appears repeatedly in the datapath, including ALU source selection, write-back selection, and next-PC selection.

### Source snapshots

![Computer Architecture-2 Page 91](/computer-architecture/assets/computer-architecture-2-page-091-2.png)

### Page-grounded details

#### Page 91

=> logic gate implementatoss with transistors (NPN)

- inverter

A -> [NOT-gate symbol] out

down
+Vcc
 |
 R
 |
out
 |
[transistor]
 |
ground

A - R -> [transistor base]

A | out
0 | 1
1 | 0


- and

A
B  -> [AND-gate symbol] out

down
+Vcc
 |
[transistor]
 |
[transistor]
 |
out
 |
R
 |
ground

A - R -> [upper transistor]
B - R -> [lower transistor]

A B | out
0 0 | 0
0 1 | 0
1 0 | 0
1 1 | 1


- or

A
B  -> [OR-gate symbol] out

down
      +Vcc
       |
A - R ->[upper transistor]
B - R ->[lower transistor]
       |
      out
       |
       R
       |
     ground

A B | Out
0 0 | 0
0 1 | 1
1 0 | 1
1 1 | 1


- Nand

A
B  -> [NAND-gate symbol] out

down
 |
R
 |
out
 |
[transistor]
 |
[transistor]
 |
ground

A - R -> [upper transistor]
B - R -> [lower transistor]

A B | out
0 0 | 1
0 1 | 1
1 0 | 1
1 1 | 0


=> Multiplexers : A multiplexer (Mux for short)
selects one of the several input values and passes
that selected value to a single output according
to a control signal called the select line.
It acts like a if-then-else in hardware. Consider
a two data-input multiplexer. It actuall y has
three inputs : two data values and a selector
(or control) value. The selector value determines

[Truncated for analysis]

### Key points

- A multiplexer selects one of several input values and passes it to a single output.
- The control signal is called the select line.
- A 2-input mux has three inputs total: two data inputs and one selector.
- The mux acts like an if-then-else in hardware.
- When `S = 0`, one data input is chosen; when `S = 1`, the other is chosen.
- The logic implementation uses two AND gates, one OR gate, and an inverted select on one branch.
- Muxes are reused throughout the processor datapath.

### Related topics

- [[32-bit-alu-organization-and-control-signals|32-bit ALU organization and control signals]]
- [[datapath-and-control-partition-in-processor-design|Datapath and control partition in processor design]]
- [[r-type-and-load-instruction-execution-flow|R-type and load instruction execution flow]]
- [[branch-and-jump-execution-in-the-datapath|Branch and jump execution in the datapath]]

### Relationships

- part-of: [[datapath-and-control-partition-in-processor-design|Datapath and control partition in processor design]]
