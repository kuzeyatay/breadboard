---
title: "Logic Blocks, Truth Tables, and Boolean Expressions"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 26", "Page 27"]
related: ["logic-gates-and-digital-abstraction", "de-morgans-laws-and-canonical-boolean-forms", "half-adder-full-adder-and-ripple-carry-addition", "combinational-and-sequential-logic-in-processors"]
tags: ["logic-blocks", "truth-table", "boolean-expression", "boolean-algebra", "half-adder", "combinational-logic", "sequential-logic"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-026.png", "/computer-architecture/assets/computer-architecture-2-page-027.png"]
---

## Logic Blocks, Truth Tables, and Boolean Expressions

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 26, Page 27

The notes define logic blocks as larger functional units built by connecting gates together. Examples range from the half adder and multiplexer to the much larger ALU. Logic blocks are divided into two categories: combinational blocks, which contain no memory and produce outputs after propagation delay, and sequential blocks, which contain memory elements such as registers or flip-flops. A single logic function can be represented in at least three equivalent ways: a gate-level diagram, a truth table, and a Boolean expression. The half-adder example illustrates these correspondences: the truth table gives outputs `S` and `C` for each input pair `A, B`; the Boolean expressions are `S = A_bar B + A B_bar` and `C = AB`; and the gate-level diagram wires inverters, AND gates, and an OR gate accordingly. The notes explain the strengths and weaknesses of each form: truth tables are the most direct behavioral specification but scale poorly because `n` inputs require `2^n` rows, while Boolean expressions support manipulation and simplification. They also list core Boolean algebra laws, including commutative, associative, identity, distributive, and complement laws.

### Source snapshots

![Computer Architecture-2 Page 26](/computer-architecture/assets/computer-architecture-2-page-026.png)

![Computer Architecture-2 Page 27](/computer-architecture/assets/computer-architecture-2-page-027.png)

### Page-grounded details

#### Page 26

=> Logic blocks area building unit that are a combination
of gates connected together to implement a larger function
For example , a half adder is a logic block : it takes two input
bits and produces a sum and carry . A multiplexer is a logic block
that selects one of several inputs . An ALU is a much larger
logic block composed of many smaller ones. (A gate can also
be considered as the smallest logic block)

down Logic blocks are categorized as one of two types whether they
contain memory . Blocks without memory are called combinational;
the blocks with memory are called Sequential.

a) Combinational devices/logic are logic blocks that have no
memory you feed input bits into a network of gates, and
after a propagation delay , the output settles to the value
dictated by the logic . They contain only AND, OR, etc gates

b) Sequential devices/logic, memory elements( registers or flip/flops)
are inserted between blocks of Combinational logic . You compute
something combinationally , store the result and then on a
later cycle use that stored value as input to the next stage
of combinational logic . For example computers are sequential
devices

(=>) Representing logic blocks
- A single

[Truncated for analysis]

#### Page 27

a) Gate level diagram is the structural representation [of] specific gates
connected by specific wires This is "close" to what ultimately gets realized
in silicon layout (in the sense that it is a concrete structure that can
be mapped through a cell library)

b) The truth table is the most direct definition; lists every input
combination and the corresponding output. It can be derived from a
gate level diagram by evaluating outputs for all possible input
combinations. However truth tables do not scale well: with n inputs
you need 2ⁿ rows, so beyond a few inputs the table "explodes". Thats
why we have boolean expressions

c) Boolen expressions are another approach to express a logic function
with logic equations using Boolean Algebra (named after Boole,
a 19th century mathematician). In boolean algebra, all the variables
have the value 0 or 1 and, in typical formulations, there are three
operations

- OR  <- logical Sum
  written as "+" as in x + y   (x v y in logic)

- AND  <- logical Product
  written as "." as in x-y or xy   (x ^ y in logic)

- NOT
  written as "x̄" or "x'"   (¬x in logic)

There are several laws of boolean algebra that are helpful in
manipulating logic equations

[Truncated for analysis]

### Key points

- Logic blocks are combinations of gates implementing larger functions.
- Combinational logic blocks have no memory; sequential blocks include memory elements.
- A logic function can be represented by a gate-level diagram, truth table, or Boolean expression.
- Truth tables scale poorly because `n` inputs require `2^n` rows.
- Boolean expressions use operations OR (`+`), AND (`.` or juxtaposition), and NOT (bar or prime).
- Useful Boolean algebra laws include commutative, associative, identity, distributive, and complement laws.
- The half adder example gives `S = A_bar B + A B_bar` and `C = AB`.

### Related topics

- [[logic-gates-and-digital-abstraction|Logic Gates and Digital Abstraction]]
- [[de-morgans-laws-and-canonical-boolean-forms|De Morgan's Laws and Canonical Boolean Forms]]
- [[half-adder-full-adder-and-ripple-carry-addition|Half Adder, Full Adder, and Ripple Carry Addition]]
- [[combinational-and-sequential-logic-in-processors|Combinational and Sequential Logic in Processors]]

### Relationships

- depends-on: [[de-morgans-laws-and-canonical-boolean-forms|De Morgan's Laws and Canonical Boolean Forms]]
- applies-to: [[half-adder-full-adder-and-ripple-carry-addition|Half Adder, Full Adder, and Ripple Carry Addition]]
