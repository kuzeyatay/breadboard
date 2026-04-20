---
title: "De Morgan's Laws and Canonical Boolean Forms"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 28", "Page 29"]
related: ["logic-blocks-truth-tables-and-boolean-expressions", "logic-gates-and-digital-abstraction", "half-adder-full-adder-and-ripple-carry-addition"]
tags: ["de-morgans-laws", "sum-of-products", "product-of-sums", "boolean-optimization", "critical-path", "nand", "nor"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-028.png", "/computer-architecture/assets/computer-architecture-2-page-029.png"]
---

## De Morgan's Laws and Canonical Boolean Forms

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 28, Page 29

The notes extend Boolean algebra with De Morgan's laws and show how truth tables can be converted into canonical expressions. De Morgan's laws relate negated OR and negated AND forms: `overline(a + b) = a_bar b_bar` and `overline(a b) = a_bar + b_bar`. Gate drawings show that a NOR function can be realized either as an OR gate with an output bubble or as an AND-like structure with input inversions, and similarly for NAND. The notes then introduce two-level canonical forms, especially sum of products (OR of AND terms) and product of sums (AND of OR terms). The specific construction procedure for sum of products is given: inspect the truth table, and for every row where the output is 1, form an AND term matching that row by complementing inputs that are 0, then OR all these terms together. The half-adder example demonstrates this method: rows `01` and `10` give `S = A_bar B + A B_bar`, while row `11` gives `C = AB`. The notes also emphasize that the same truth table can have many gate implementations, so Boolean algebra is used for logic optimization to reduce area, energy, and critical path delay.

### Source snapshots

![Computer Architecture-2 Page 28](/computer-architecture/assets/computer-architecture-2-page-028.png)

![Computer Architecture-2 Page 29](/computer-architecture/assets/computer-architecture-2-page-029.png)

### Page-grounded details

#### Page 28

In addition, there are two other usefull theorems called
De Morgan's laws :

i) \overline{a + b} = \bar{a} - \bar{b} which states there are two ways to describe
a not or (nor) operation

-> [diagram: OR-shaped gate with inputs labeled `A` and `B`, output labeled `Z`, with inversion bubble on output]
classic approach

-> [diagram: AND-shaped gate with inputs labeled `A` and `B`, inversion bubbles on both inputs, output labeled `Z`]
inverse at input

ii) \overline{a - b} = \bar{a} + \bar{b} which states there are two ways to describe
a not and (nand) operation

-> [diagram: AND-shaped gate with inputs labeled `A` and `B`, output labeled `Z`, with inversion bubble on output]
classic

-> [diagram: OR-shaped gate with inputs labeled `A` and `B`, inversion bubbles on both inputs, output labeled `Z`]

-> Any boolean function can be expressed in a two level form
(allowing inversions only on individual variables and possibly at
the final output) There are two canonical families:
sum of products (or of and terms) and product of sums (And of Or terms)

b) We can get a sum of products form of a logic block by
inspecting its truth table, for each row where the
output is 1, you create a product

[Truncated for analysis]

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

### Key points

- De Morgan's laws convert between negated OR and negated AND forms.
- NOR and NAND can be represented equivalently using output inversion or input inversions.
- Canonical two-level forms include sum of products and product of sums.
- Sum of products is derived by creating a product term for each truth-table row where the output is 1.
- Inputs that are 0 in a selected row are complemented in the product term.
- Many different gate-level implementations can realize the same truth table.
- Boolean optimization aims to reduce gate count and critical path while preserving function.

### Related topics

- [[logic-blocks-truth-tables-and-boolean-expressions|Logic Blocks, Truth Tables, and Boolean Expressions]]
- [[logic-gates-and-digital-abstraction|Logic Gates and Digital Abstraction]]
- [[half-adder-full-adder-and-ripple-carry-addition|Half Adder, Full Adder, and Ripple Carry Addition]]

### Relationships

- applies-to: [[half-adder-full-adder-and-ripple-carry-addition|Half Adder, Full Adder, and Ripple Carry Addition]]
