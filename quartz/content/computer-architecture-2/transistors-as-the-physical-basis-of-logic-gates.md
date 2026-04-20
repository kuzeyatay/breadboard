---
title: "Transistors as the physical basis of logic gates"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 90", "Page 91"]
related: ["full-adder-and-half-adder-construction", "multiplexer-behavior-and-logic-implementation", "register-file-ports-and-d-latch-foundation"]
tags: ["transistor", "npn-transistor", "base", "collector", "emitter", "inverter", "nand"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-090-2.png", "/computer-architecture/assets/computer-architecture-2-page-091-2.png"]
---

## Transistors as the physical basis of logic gates

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 90, Page 91

The notes connect logic design to hardware implementation by stating that each logic gate is physically implemented using transistors. An NPN transistor is presented as an electrically controlled switch with three terminals: base, collector, and emitter. In the described arrangement, positive voltage is applied to the collector, and current flows from collector to emitter when sufficient base current is provided. This device model is then used to show transistor-level implementations of an inverter, AND, OR, and NAND gate. Each transistor network is paired with a truth table, making explicit how different series or parallel transistor arrangements realize standard Boolean functions. This topic is foundational because it links abstract logic operations, such as those used in half adders, multiplexers, and control logic, to actual circuit structures.

### Source snapshots

![Computer Architecture-2 Page 90](/computer-architecture/assets/computer-architecture-2-page-090-2.png)

![Computer Architecture-2 Page 91](/computer-architecture/assets/computer-architecture-2-page-091-2.png)

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

- Logic gates are physically implemented using transistors.
- The notes focus on an NPN transistor.
- An NPN transistor has three terminals: base, collector, and emitter.
- The transistor acts like an electrically controlled switch.
- Current flows from collector to emitter when there is sufficient base current.
- The notes show transistor implementations for NOT, AND, OR, and NAND gates.
- Each transistor circuit is paired with a truth table to confirm the logic behavior.

### Related topics

- [[full-adder-and-half-adder-construction|Full adder and half adder construction]]
- [[multiplexer-behavior-and-logic-implementation|Multiplexer behavior and logic implementation]]
- [[register-file-ports-and-d-latch-foundation|Register file ports and D-latch foundation]]

