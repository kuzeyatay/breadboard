---
title: "Full adder and half adder construction"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 90"]
related: ["32-bit-alu-organization-and-control-signals", "transistors-as-the-physical-basis-of-logic-gates", "32-bit-ripple-carry-adder"]
tags: ["full-adder", "half-adder", "carry-in", "carry-out", "sum"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-090-2.png"]
---

## Full adder and half adder construction

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 90

The arithmetic core of the datapath is built from adders, and the notes derive a full adder from two half adders plus an OR gate. A half adder takes inputs `ai` and `bi` and produces a sum and carry-out; a full adder extends this by including a carry-in so that chained addition becomes possible. The notes show that the first half adder combines `ai` and `bi`, then its sum feeds a second half adder together with `Carry In`, and the two carry outputs are ORed to produce the final carry-out. The notes also spell out the logic-level implementation of a half adder: the sum is realized as an XOR-like structure using two NOT gates, two AND gates, and an OR gate, while the carry-out is a direct AND of the two inputs. This is important because the ALU and 32-bit adder rely on these structures repeatedly across all bit positions.

### Source snapshots

![Computer Architecture-2 Page 90](/computer-architecture/assets/computer-architecture-2-page-090-2.png)

### Page-grounded details

#### Page 90

[Top margin elements]

[Small 7-cell table:]
Su  Mo  Tu  We  Th  Fr  Sa

No. ______

Date      /      /

down

The actual arithmetic is done by full adders: (which is built by half adders)

[Diagram: left side]
ai, bi -> [Half Adder]
- output right: S(um)
- output lower right: Carry out

Carry In -> [Half Adder]
- input from left: S(um)
- output right: (Sum)
- output lower right: carry out

The two carry-out lines go into an OR gate.
- OR gate output: Carry out

[Diagram: right side]
{ [brace grouping the half-adder construction into a full adder] }

ai ->
bi ->   [Full adder]  -> S(um)
Carry In up from below into the block
Carry out up from top of the block

[Small diagram below left]
ai, bi -> [Half Adder]
- output right: (Sum)
- output top: Carry out

down

A half adder (circuit-wise) is implemented as:

[Logic diagram]
Inputs: ai, bi

For Sum:
- ai passes through a NOT gate on the upper branch
- that result and bi feed an AND gate
- bi passes through a NOT gate on the lower branch
- that result and ai feed another AND gate
- the two AND outputs feed an OR gate
- OR output labeled: Sum

For Carry out:
- ai and bi feed an AND gate directly
- AND output labeled: (Carry out)

down

[Truncated for analysis]

### Key points

- A full adder is built from two half adders and one OR gate.
- The first half adder adds `ai` and `bi`.
- The second half adder adds the intermediate sum and `Carry In`.
- The two carry-out signals are ORed to produce the full-adder carry-out.
- A half adder outputs sum and carry-out from two inputs.
- The half-adder sum logic is implemented using an XOR-like network of NOT, AND, and OR gates.
- The half-adder carry-out is implemented with a direct AND gate on the two inputs.

### Related topics

- [[32-bit-alu-organization-and-control-signals|32-bit ALU organization and control signals]]
- [[transistors-as-the-physical-basis-of-logic-gates|Transistors as the physical basis of logic gates]]
- [[32-bit-ripple-carry-adder|32-bit ripple-carry adder]]

### Relationships

- depends-on: [[transistors-as-the-physical-basis-of-logic-gates|Transistors as the physical basis of logic gates]]
