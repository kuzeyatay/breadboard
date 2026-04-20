---
title: "Reg Variables and Blocking vs Nonblocking Assignment"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 39", "Page 40"]
related: ["procedural-blocks-sensitivity-lists-and-combinational-always-blocks", "sequential-circuits-and-clocked-storage", "rtl-modeling-for-finite-state-machines"]
tags: ["reg", "wire", "blocking-operator", "nonblocking-assignment", "always", "flip-flop"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-039.png", "/computer-architecture/assets/computer-architecture-2-page-040.png"]
---

## Reg Variables and Blocking vs Nonblocking Assignment

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 39, Page 40

The notes explain that signals assigned inside procedural blocks are not of type `wire`; instead, they use the type `reg`. A `reg` is a variable that can hold a value assigned from within a procedural block. Although `reg` often corresponds to a register or flip-flop in hardware, the notes emphasize that this is not always the case. Two assignment operators are then distinguished. Blocking assignment `=` updates the left-hand side immediately, so subsequent statements in the same block observe the new value. Nonblocking assignment `<=` separates evaluation from update: right-hand sides are evaluated when the block triggers, but the left-hand side updates are postponed until the end of the simulation time step. This mirrors real edge-triggered hardware, where flip-flops all update together on a clock edge and no one flip-flop sees another's new value during that same edge. The distinction is central for writing correct sequential Verilog.

### Source snapshots

![Computer Architecture-2 Page 39](/computer-architecture/assets/computer-architecture-2-page-039.png)

![Computer Architecture-2 Page 40](/computer-architecture/assets/computer-architecture-2-page-040.png)

### Page-grounded details

#### Page 39

[x] these are wrong:

always @(a)                      always @(b)
begin                            begin
    sum= a ^ b;                      sum= a ^ b;
    cary= a & b;                     cary= a & b;
end                              end

down This block only executes when a changes so if b changes and a doesn't the
block doesnt execute which is not correct combinational logic

-> However the variables inside the procedural block are not
the variable type wire, they are another variable type called reg

[ex]    reg r;

        always @(*) r = na;

The keyword reg means the signal can store a value assigned
inside a procedural block. it is often a register/ flip flop in hardware
but not always

-> Inside Procedural blocks, there are two assignment operators :

1) The first one is called the blocking operator, written as "="
   When a blocking assignment executes, the variable on the lefthand
   side immediatly takes the value of the expression on the right
   hand side, Any subsequent statement in the same procedural block
   sees this updated value

2) The second is the nonblocking assignment operator, written as "<="
   occures in two conceptual phases during a simulation
   t

[Truncated for analysis]

#### Page 40

are schedule to be written at the end of the time step, after
all statements in the block have been evaluated. As a result,
if a variable is assigned with a nonblocking assignment
near the top of the block, any later statements in the
same block that reads that variable will still
see its old value, not the newly computed one.

|This matters because consider real flip flops in hardware
On a rising clock edge, all flip flops update at the same time;
no flip flop sees the updated value of another flip flop
during that same clock edge [unclear]

=> Test benches
. A test bench is a verilog module whose only job is to test
another module. It supplies input signals (called stimuli) to the
unit under test and it generates a waveform so you can check whether
the module behaves correctly

Name    Value
Sum     0
carry   0
a       0
b       0

[Diagram: timing waveform to the right of the table, with four traces corresponding top-to-bottom to `Sum`, `carry`, `a`, `b`. The traces show square-wave transitions over time, with two dashed vertical markers indicating time instants.]

module half_adder_test bench

reg in1    { reg because we will use
            assign
reg in2

wire out1  } wire be

[Truncated for analysis]

### Key points

- Variables assigned in procedural blocks are typically declared as `reg`.
- `reg` means the signal can store a value assigned in a procedural block.
- Blocking assignment uses `=` and updates immediately.
- Nonblocking assignment uses `<=` and delays updates until the end of the time step.
- Later statements in the same block see updated values with blocking assignment.
- Later statements in the same block still see old values with nonblocking assignment.
- Nonblocking assignment models simultaneous flip-flop updates on a clock edge.

### Related topics

- [[procedural-blocks-sensitivity-lists-and-combinational-always-blocks|Procedural Blocks, Sensitivity Lists, and Combinational Always Blocks]]
- [[sequential-circuits-and-clocked-storage|Sequential Circuits and Clocked Storage]]
- [[rtl-modeling-for-finite-state-machines|RTL Modeling for Finite State Machines]]

