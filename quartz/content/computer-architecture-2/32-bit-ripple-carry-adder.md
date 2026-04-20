---
title: "32-bit ripple-carry adder"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 92"]
related: ["full-adder-and-half-adder-construction", "32-bit-alu-organization-and-control-signals", "datapath-and-control-partition-in-processor-design"]
tags: ["ripple-carry-adder", "full-adder", "carry-in", "carry-out", "sum", "adder"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-092-2.png"]
---

## 32-bit ripple-carry adder

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 92

The notes define the 32-bit adder as a chain of 32 full adders connected so that the carry-out of one stage becomes the carry-in of the next. This is the classic ripple-carry organization. The adder accepts bitwise pairs `a0/b0` through `a31/b31`, along with an initial carry-in, and produces a 32-bit sum plus a final carry-out. The notes remark that one could conceptually use one half adder and 31 full adders, but the implementation shown uses 32 full adders for convenience. Because each bit position must wait for the carry from the previous position, carry information ripples from low-order bits to high-order bits. This adder appears both as a reusable arithmetic block and as part of other datapath functions such as computing `PC + 4` and branch target addresses.

### Source snapshots

![Computer Architecture-2 Page 92](/computer-architecture/assets/computer-architecture-2-page-092-2.png)

### Page-grounded details

#### Page 92

[Top margin printed elements]
Su  Mo  Tu  We  Th  Fr  Sa
No. __________
Date ___ / ___ /

-> The adder (32 bit ripple carry adder)

- The adder is literally just 32 full adders connected. (why not 1 half-adder and 31 full adders?) -(convenience)

[Diagram]
a0, b0           a1, b1           a2, b2                              a31, b31
down                down                down                                   down
┌─────────┐      ┌─────────┐      ┌─────────┐                         ┌────────────┐
Cin -> Full
       Adder0 ─cout─ cin -> Full
                          Adder1 ─cot─ cin -> Full
                                             Adder2 ─cout── ... ──> cin -> Full
                                                                                  Adder31
└─────────┘      └─────────┘      └─────────┘                         └────────────┘
down                down                down                                   down
Sum[0]           Sum[1]           Sum[2]                              sum[31]

[Large brace/curved bracket under the chain, spanning the adders]

[Small symbol/diagram below brace]
a -> [full-adder-like shape]
b -> [same shape]
Cin labeled near upper input wit

[Truncated for analysis]

### Key points

- The 32-bit adder is built from 32 full adders connected in sequence.
- Each full adder receives one bit of `a`, one bit of `b`, and a carry-in.
- Each stage produces one sum bit and a carry-out to the next stage.
- The carry-out of one stage becomes the carry-in of the next stage.
- The notes choose 32 full adders for convenience rather than mixing a half adder at the start.
- The ripple-carry adder is used as a general arithmetic building block in the datapath.

### Related topics

- [[full-adder-and-half-adder-construction|Full adder and half adder construction]]
- [[32-bit-alu-organization-and-control-signals|32-bit ALU organization and control signals]]
- [[datapath-and-control-partition-in-processor-design|Datapath and control partition in processor design]]

### Relationships

- depends-on: [[full-adder-and-half-adder-construction|Full adder and half adder construction]]
