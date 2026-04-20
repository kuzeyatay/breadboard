---
title: "Behavioral Modeling and Continuous Assignment"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 37"]
related: ["gate-level-modeling-with-verilog-modules-and-wires", "procedural-blocks-sensitivity-lists-and-combinational-always-blocks", "verilog-as-a-hardware-description-language"]
tags: ["behavioural-modelling", "assign", "continuous-assignment", "bitwise-and", "bitwise-or", "bitwise-xor", "half-adder"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-037.png"]
---

## Behavioral Modeling and Continuous Assignment

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 37

Behavioral modeling describes the functional relationship between inputs and outputs without manually wiring each gate. The notes present a half-adder example in which `sum` and `carry` are defined directly using Boolean expressions: `sum = a ^ b` and `carry = a & b`. This style relies on the continuous assignment statement `assign left = right_expression;`, which continuously evaluates the right-hand side and drives the left-hand side as long as the relationship exists. The notes also explain the basic Verilog operators used in expressions: `&` for bitwise AND, `|` for bitwise OR, `^` for bitwise XOR, and `~` for bitwise NOT. A Boolean example is given as `assign y = (a & b) | c`, corresponding to the Boolean expression `ab + c`. Behavioral modeling leaves hardware implementation choices to the synthesis tool, making it far more scalable than gate-level modeling while still being compatible with synthesis into real hardware.

### Source snapshots

![Computer Architecture-2 Page 37](/computer-architecture/assets/computer-architecture-2-page-037.png)

### Page-grounded details

#### Page 37

2. Behavioural Modelling

- Instead of wiring every gate, we can describe only the functional relationship
between inputs and outputs, leaving the hardware implementation to [unclear]

Vex/

module halfadder 2(
    input a,
    input b,
    output sum,
    output carry,
);

=>

[Diagram: inputs `a` and `b` feeding two gates; the upper gate is labeled `sum`, the lower gate is labeled `carry`. The sketch shows both inputs branching to both gates, representing a half-adder.]

assign sum = a ^ b;
assign carry = a & b;

endmodule

-> The statement assign left = right_expression; is called a continuous assignment
Once wires exist, they must be driven by something. One way to drive
a wire is by using a continuous assignment statement. it permanently establishes
a logical relationship between signals The right hand side is continuously
evaluated, and the result continuously drives the left hand side.

-> The right hand side of an Assign statement is an expression that
Verilog provides the operators for

- & means bitwise AND                    - ^ means bitwise XOR

- | means bitwise OR                     - ~ means bitwise NOT

Ex/ assign y = (a & b) | c    means a b + c in boolean algebr

[Truncated for analysis]

### Key points

- Behavioral modeling focuses on functional relationships rather than explicit gate wiring.
- The half-adder can be described with `assign sum = a ^ b;` and `assign carry = a & b;`.
- `assign` creates a continuous assignment that constantly drives a signal.
- The right-hand side of an assign statement is continuously evaluated.
- Operators include `&`, `|`, `^`, and `~`.
- Behavioral modeling is more practical than gate-level modeling for larger circuits.

### Related topics

- [[gate-level-modeling-with-verilog-modules-and-wires|Gate-Level Modeling with Verilog Modules and Wires]]
- [[procedural-blocks-sensitivity-lists-and-combinational-always-blocks|Procedural Blocks, Sensitivity Lists, and Combinational Always Blocks]]
- [[verilog-as-a-hardware-description-language|Verilog as a Hardware Description Language]]

### Relationships

- related: [[procedural-blocks-sensitivity-lists-and-combinational-always-blocks|Procedural Blocks, Sensitivity Lists, and Combinational Always Blocks]]
