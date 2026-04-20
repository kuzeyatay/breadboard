---
title: "Logic Gates and Digital Abstraction"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 25"]
related: ["combinational-and-sequential-logic-in-processors", "logic-blocks-truth-tables-and-boolean-expressions", "de-morgans-laws-and-canonical-boolean-forms"]
tags: ["digital-abstraction", "logic-gate", "not-gate", "and-gate", "or-gate", "xor-gate", "nand-gate", "nor-gate"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-025.png"]
---

## Logic Gates and Digital Abstraction

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 25

The digital logic section begins by restating the key engineering abstraction behind reliable computing: wire voltages are treated not as arbitrary analog quantities but as belonging to one of two valid regions labeled 0 and 1. This digital abstraction makes circuits robust to noise and manufacturing variation compared with analog representations. Once information is expressed as bits, computation becomes a question of mapping input bits to output bits according to Boolean rules. Logic gates are the primitive hardware elements that perform these mappings. The notes define and tabulate several standard gates: inverter (NOT), AND, OR, XOR, NAND, and NOR. Each gate is specified by a truth table listing all possible input combinations and the corresponding output. The notes also include a practical drawing rule: gate symbols are drawn with inputs entering from the left and outputs leaving on the right; some alternative orientations are marked as not allowed in the lecture notes. This topic establishes the lowest-level vocabulary used later for logic blocks, Boolean algebra, and arithmetic circuits such as adders.

### Source snapshots

![Computer Architecture-2 Page 25](/computer-architecture/assets/computer-architecture-2-page-025.png)

### Page-grounded details

#### Page 25

=>Combinatorial Circuits : Basic binary logic for hardware

- The central trick that makes digital computers reliable is
digital abstraction : we deliberately restrict ourselves to interpreting
a wires voltage as belonging to one of two regions, which we label
0 and 1. In other words, we perform a reliable translation between
a discrete variable (a bit) and an approximate value of a continous
variable (a voltage). This idea matters because physical components
are never perfect. Temperature, noise and manufacturing variation all
disrupt voltages. Analog computers (historically) represent information
directly with continous variables, which makes them fundamentally sensitive
to such perturbations

Once we accept this abstraction, "computation" became a question
of : given some input bits what output bits should be produced?
which is answered by binary logic.

-> A logic gate is a small hardware device that takes one or more
input bits and produces an output bit according to a fixed rule. This
fixed rule can be demonstrated by a truth table. These gates
are used to build logic blocks, and they implement basic logic functions.
Physically, they are built in circuits as transistors,

- i

[Truncated for analysis]

### Key points

- Digital abstraction treats voltages as belonging to discrete 0 and 1 regions.
- This abstraction makes digital computers more reliable than analog representations under noise and variation.
- Logic gates map one or more input bits to an output bit using a fixed rule.
- Truth tables define the behavior of gates.
- The standard gates introduced are NOT, AND, OR, XOR, NAND, and NOR.
- Gate diagrams are conventionally drawn with inputs on the left and outputs on the right.

### Related topics

- [[combinational-and-sequential-logic-in-processors|Combinational and Sequential Logic in Processors]]
- [[logic-blocks-truth-tables-and-boolean-expressions|Logic Blocks, Truth Tables, and Boolean Expressions]]
- [[de-morgans-laws-and-canonical-boolean-forms|De Morgan's Laws and Canonical Boolean Forms]]

### Relationships

- part-of: [[logic-blocks-truth-tables-and-boolean-expressions|Logic Blocks, Truth Tables, and Boolean Expressions]]
