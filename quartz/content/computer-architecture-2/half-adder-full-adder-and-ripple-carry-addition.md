---
title: "Half Adder, Full Adder, and Ripple Carry Addition"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 29", "Page 30"]
related: ["unsigned-binary-arithmetic", "logic-blocks-truth-tables-and-boolean-expressions", "de-morgans-laws-and-canonical-boolean-forms", "combinational-and-sequential-logic-in-processors"]
tags: ["half-adder", "full-adder", "ripple-carry-adder", "sum", "carry", "xor", "asic", "fpga"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-029.png", "/computer-architecture/assets/computer-architecture-2-page-030.png"]
---

## Half Adder, Full Adder, and Ripple Carry Addition

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 29, Page 30

The final pages apply Boolean logic to arithmetic hardware. A half adder is defined as a combinational circuit that adds two single-bit inputs `A` and `B` and produces two outputs: sum and carry. The sum function is XOR and the carry function is AND. To add multi-bit numbers, adders are connected in stages so that the carry produced by a lower-order bit feeds the next stage. The notes state that there is one half adder for the least significant bit and then full adders for higher positions, forming a ripple carry adder. A worked 2-bit example shows a half adder handling `A0` and `B0`, producing `S0` and a carry into a full adder that takes `A1`, `B1`, and `Cin` and produces `S1` and `Cout`. The full-adder truth table is listed for all eight input combinations. The implementation diagram realizes the full adder using two half adders plus an OR gate to combine carry outputs. The notes connect this to digital design practice by stating that truth tables specify combinational behavior, while synthesis tools convert these specifications into optimized logic networks using standard gates in ASICs or LUTs and flip-flops in FPGAs.

### Source snapshots

![Computer Architecture-2 Page 29](/computer-architecture/assets/computer-architecture-2-page-029.png)

![Computer Architecture-2 Page 30](/computer-architecture/assets/computer-architecture-2-page-030.png)

### Page-grounded details

#### Page 29

-> A truth table typically has infinitely many correct gate implementations
One could implement the same function using different gate types, different
factorizations or even by introducing xor gates directly insted of
building them from And/or/Not.

down However, different implementations are not equally good, more gates usually
mean a larger die area, which tends to increase cost and energy,
and it often increases the critical path: (the longest propagation path
from any input to any output) which reduces the maximum clock
frequency we can use.

down This is why we use Boolean algebra, it provides laws that we
have discussed that lets us transform expression while preserving
meaning, with the goal of reducing logic. This is called
boolean optimization Historically, it was done by hand but now computers
do it

√ ex/ Equivalent representations of the half adder

[Diagram 1: half-adder circuit with inputs labeled `A` and `B`. The top gate is an XOR-like gate with output labeled `S`. The bottom gate is an AND gate with output labeled `C`. Wires from `A` and `B` feed both gates.]

[Diagram 2: half-adder circuit with inputs labeled `A` and `B`. Each input branches through an inverter/n

[Truncated for analysis]

#### Page 30

=> The half Adder is a combinational logic circuit that adds
two input bits A and B and produces two outputs (Sum) and
(Carry). The sum corresponds to a xor gate and carry,
in and gate

A
[diagram: input `A` and input `B` feed two gates; the upper gate is an XOR-like shape labeled `Sum`, the lower gate is an AND-like shape labeled `Carry`.]
B

To add multi-bit numbers, we connect adders in stages. There
exists one half adder (for the LSB) and n amount of full adders
to make a "n-1" bit ripple carry adder

ex/ 2-bit ripple carry adder! (Now we can do 1 + 1 !)

[diagram: `A0` and `B0` enter a box labeled `half Adder`; outputs are `S0` and a carry line going downward/right into the next stage.]

A_0 B_0 | S C
0 0 | 0 0
0 1 | 1 0
1 0 | 1 0
1 1 | 0 1

[diagram: `A1`, `B1`, and `Cin` enter a box labeled `Full adder`; outputs are `S1` and `Cout`. A downward arrow points to the implementation diagram below.]

A_1  B_1  C_in | S_1  C_out
0   0   0    | 0   0
0   0   1    | 1   0
0   1   0    | 1   0
0   1   1    | 0   1
1   0   0    | 1   0
1   0   1    | 0   1
1   1   0    | 0   1
1   1   1    | 1   1

[diagram: full-adder implementation using two half adders and an OR gate.
- Left half ad

[Truncated for analysis]

### Key points

- A half adder adds two bits and outputs sum and carry.
- Half-adder sum is XOR and carry is AND.
- Multi-bit addition is built by connecting adder stages.
- A ripple carry adder uses carry-out from one stage as carry-in to the next.
- The least significant stage can use a half adder; higher stages use full adders.
- A full adder takes `A`, `B`, and `Cin` and produces `Sum` and `Cout`.
- A full adder can be implemented from two half adders and an OR gate.

### Related topics

- [[unsigned-binary-arithmetic|Unsigned Binary Arithmetic]]
- [[logic-blocks-truth-tables-and-boolean-expressions|Logic Blocks, Truth Tables, and Boolean Expressions]]
- [[de-morgans-laws-and-canonical-boolean-forms|De Morgan's Laws and Canonical Boolean Forms]]
- [[combinational-and-sequential-logic-in-processors|Combinational and Sequential Logic in Processors]]

