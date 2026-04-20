---
title: "Procedural Blocks, Sensitivity Lists, and Combinational Always Blocks"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 38", "Page 39"]
related: ["behavioral-modeling-and-continuous-assignment", "reg-variables-and-blocking-vs-nonblocking-assignment", "sequential-circuits-and-clocked-storage"]
tags: ["always", "sensitivity-list", "posedge", "negedge", "combinational-block", "assign"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-038.png", "/computer-architecture/assets/computer-architecture-2-page-039.png"]
---

## Procedural Blocks, Sensitivity Lists, and Combinational Always Blocks

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 38, Page 39

To model sequential execution of statements within Verilog while still representing hardware behavior, the notes introduce procedural blocks using `always @(event-list) begin ... end`. These blocks execute when events in the sensitivity list occur. The material shows that combinational logic can be described procedurally, but only if the block is triggered whenever any right-hand-side input changes. For that reason, `always @(*)` is recommended for combinational logic, because it automatically includes all relevant signals. Examples using `always @(a)` or `always @(b)` are marked wrong: if only one input is in the sensitivity list, the block does not respond correctly to changes on the other input, so it no longer models proper combinational behavior. The notes also show edge-triggered event controls such as `posedge` and `negedge`, which are used for clocked logic. This topic is essential because it connects the syntax of procedural blocks to correct hardware intent.

### Source snapshots

![Computer Architecture-2 Page 38](/computer-architecture/assets/computer-architecture-2-page-038.png)

![Computer Architecture-2 Page 39](/computer-architecture/assets/computer-architecture-2-page-039.png)

### Page-grounded details

#### Page 38

=> Sequential logic

. So far, all outputs depend only on current inputs. But many
circuits require to "remember" previous values, which corresponds
to registers or flip-flops in hardware. These hardware update their
stored value only at specific moments, typically on a clock edge.
To model such behaviour, verilog introduces procedural blocks, that

execute sequentially                         , or sensitivity list

          always @ (event-list)
          begin

                    statements

          end

! ex/

assign sum = a ^ b;          same
assign carry = a & b;        <=>    always @ (a or b) sum = a ^ b.
                                    always @ (*)                execute when a or b changes
                                                   ---------------------------->
                                    begin
                                             carry = a & b;      recommended approach:
                                    end                         means that this is
                                                                a combinational block
                                                                and update if anything

[Truncated for analysis]

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

### Key points

- `always @(event-list)` defines a procedural block.
- Statements inside a procedural block execute sequentially within that block.
- `always @(*)` is the recommended form for combinational logic.
- `always @(a or b)` can model a combinational block if all dependencies are listed.
- `always @(a)` or `always @(b)` alone is incorrect for logic depending on both signals.
- `posedge` triggers on a 0->1 transition and `negedge` on a 1->0 transition.

### Related topics

- [[behavioral-modeling-and-continuous-assignment|Behavioral Modeling and Continuous Assignment]]
- [[reg-variables-and-blocking-vs-nonblocking-assignment|Reg Variables and Blocking vs Nonblocking Assignment]]
- [[sequential-circuits-and-clocked-storage|Sequential Circuits and Clocked Storage]]

### Relationships

- depends-on: [[reg-variables-and-blocking-vs-nonblocking-assignment|Reg Variables and Blocking vs Nonblocking Assignment]]
