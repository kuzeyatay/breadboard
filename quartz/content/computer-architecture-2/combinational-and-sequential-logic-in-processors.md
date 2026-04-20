---
title: "Combinational and Sequential Logic in Processors"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 21", "Page 26"]
related: ["cpu-time-clocking-and-the-basic-performance-equation", "single-cycle-datapath-and-five-classic-computer-components", "logic-gates-and-digital-abstraction", "logic-blocks-truth-tables-and-boolean-expressions"]
tags: ["combinational-logic", "sequential-logic", "state-elements", "registers", "flip-flops", "propagation-delay", "clock-period"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-021.png", "/computer-architecture/assets/computer-architecture-2-page-026.png"]
---

## Combinational and Sequential Logic in Processors

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 21, Page 26

To explain why clock period matters, the notes divide processor hardware into combinational circuits and state elements. Combinational logic has no memory: its outputs depend only on current inputs and change after a propagation delay when inputs change. Examples include adders, arithmetic logic units, multiplexers, and logic gates. State elements such as registers and flip-flops store values across time and update only on clock edges, usually rising edges. A processor therefore operates rhythmically: at each active edge, state elements capture values, and between edges combinational logic computes new results from those stored values. This yields a crucial timing constraint: the clock period must be long enough for the slowest combinational path to settle before the next state update. If the period is too short, registers may capture incomplete or incorrect results. This idea links abstract performance metrics to the physical design of datapaths and logic blocks, because the longest combinational delay limits the maximum safe clock frequency.

### Source snapshots

![Computer Architecture-2 Page 21](/computer-architecture/assets/computer-architecture-2-page-021.png)

![Computer Architecture-2 Page 26](/computer-architecture/assets/computer-architecture-2-page-026.png)

### Page-grounded details

#### Page 21

The clock period represent the amount of time available for the
processor to perform a step of computation before the next update
of its internal state.

-> Before continuing, it is important to know that a processor consists of
two fundamental types of hardware components (1) Combinational circuits
(2) state elements

i. Combinational logic is circuitry whose outat depends only on its
current inputs. it has no memory. If the inputs change, the outputs
eventually change as well after a short delay, These are the
circuits that actually perform operations, Examples include:
adders, arithmetic logic units, multiplexers, and logic gates

downup However combinational circuits does not produce results instantanly.
Electrical signals require time to propagate through transistors
and wires. This delay is called propagation delay or combinational delay

ii. State elements are circuitry that stores values across time.
Examples include registers and flip-flops. State elements hold
data until the clock signals them to update. They change their
stored values only on clock edges (typically rising edge)

↳ The processor operates in a repeating rhythm. At each rising
edge, State elements update th

[Truncated for analysis]

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

### Key points

- Combinational logic depends only on current inputs and has no memory.
- Combinational circuits include adders, ALUs, multiplexers, and gates.
- State elements store values across time and update on clock edges.
- Registers and flip-flops are examples of state elements.
- Between clock edges, combinational logic computes new values from stored state.
- The clock period must exceed the longest combinational propagation delay.
- A too-short period causes incorrect or incomplete values to be stored.

### Related topics

- [[cpu-time-clocking-and-the-basic-performance-equation|CPU Time, Clocking, and the Basic Performance Equation]]
- [[single-cycle-datapath-and-five-classic-computer-components|Single-Cycle Datapath and Five Classic Computer Components]]
- [[logic-gates-and-digital-abstraction|Logic Gates and Digital Abstraction]]
- [[logic-blocks-truth-tables-and-boolean-expressions|Logic Blocks, Truth Tables, and Boolean Expressions]]

### Relationships

- depends-on: [[logic-gates-and-digital-abstraction|Logic Gates and Digital Abstraction]]
