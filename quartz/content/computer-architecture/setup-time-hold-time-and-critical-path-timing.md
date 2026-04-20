---
title: "Setup Time, Hold Time, and Critical Path Timing"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 45", "Page 46", "Page 47"]
related: ["d-latch-and-edge-triggered-d-flip-flop", "sequential-circuits-and-clocked-storage", "registers-and-register-files"]
tags: ["setup-time", "hold-time", "critical-path", "clock-period", "rising-clock-edge", "flip-flop", "combinational-logic"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-045-2.png", "/computer-architecture/assets/computer-architecture-2-page-046-2.png"]
---

## Setup Time, Hold Time, and Critical Path Timing

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 45, Page 46, Page 47

The notes explain that even though a flip-flop samples on a clock edge, the physical process is not instantaneous. Internal transistors must switch and internal nodes must charge or discharge, so the input must be stable for a window around the active edge. Setup time `tSU` is the minimum time the input must remain stable before the rising edge; hold time `tH` is the minimum time the input must remain stable after the edge. Violating either can cause incorrect storage or unusually slow settling. The notes then extend this to system-level timing using two flip-flops separated by combinational logic. After the first flip-flop launches a new value, the signal propagates through gates with delay, and the slowest such path is the critical path. For correct operation, the next clock period must be long enough for the critical-path delay plus the setup-time margin before the receiving flip-flop samples. Hold time is a complementary requirement immediately after the edge.

### Source snapshots

![Computer Architecture-2 Page 45](/computer-architecture/assets/computer-architecture-2-page-045-2.png)

![Computer Architecture-2 Page 46](/computer-architecture/assets/computer-architecture-2-page-046-2.png)

### Page-grounded details

#### Page 45

D

[Diagram: a master-slave D flip-flop made from two D latches in series.]

Left input label: `D`
First block label:
`master`
`D latch`

Clock line below first block with an inverter symbol feeding the master latch clock.
Label near inverter: `vclk'`
Main clock label: `clk`

Between blocks labels:
Top: `Qm`
Bottom: `Q̅m`

Second block label:
`slave`
`D latch`

Input to second block top label: `D`
Clock input to second block bottom label: `clk`

Outputs on right:
Top: `Q`
Bottom: `Q̅`

[Timing diagram below the flip-flop: a repeating square-wave clock.]

Annotations under the timing diagram:
`down`
`storage`
`(positive trigger)`

`falling edge`
`(negative trigger)`

`<--------->`
`Q stable`

A rising edge flip flop can be built from two D latches in
series, called the master latch and the slave latch, driven
by the same clock. Output of the master d latch (Qm) only
changes when the clock is low and output of the slave d latch(Q)
only changes when clock is high meaning they never change at the
same time (not transparent). Output Q only changes on a rising
clock edge (0->1)

↳ When the clock edge arrives, the flip flop briefly becomes sensitive
to its input and copies the input value

[Truncated for analysis]

#### Page 46

- Setup Time (tₛᵤ) is the minimum time the input must be stable
before the rising clock edge. If the input is still changing in the
last tₛᵤ before the edge then at that moment the flip flop sees,
the input voltage may be in the middle of a transition. In that case,
the internal circuitry may capture the wrong value because the
voltage could be near the threshold where 0 and 1 are
distinguished.

- Hold Time (tₕ) is the minimum time the input must remain
stable after the rising clock edge. Even though the clock
edge has occurred, the flip flops internal nodes are still settling
to a final stored 0 or stored 1 for a short time. If the
input changes too soon after the edge (inside tₕ), it can disturb
that settling process and again cause the wrong stored value
or abnormally slow settling

-> A large synchronous System (like a CPU datapath or controller)
is built by repeating a simple pattern:

1) Store a value (state) in flip-flops

2) Compute a new value from the Stored value using
combinational logic ...

3) Store that result back into flip-flops on the next
clock edge.

[Diagram: block diagram with an arrow from `DFF1` to an oval labeled `combinational logic`, then an arrow to `DF

[Truncated for analysis]

#### Page 47

√ At a rising clock edge, DFF1 updates its output Q1 to a new stored
bit. After that, DFF1 will not change Q1. So for almost the entire
clock cycle Q1 is stable. When Q1 changes at the clock edge, that
change propagates through the combinational logic. Because each gate has delay,
the value at the input of DFF2 does not become correct immediately, it
becomes correct only after signals pass through all the gates on the path.

↳ The maximum delay through all logic gates is the worse case time it can
take for the correct value to reach DFF2's input after DFF1 launches
a change, which is called the critical path

√ Since DFF2 will sample on the next rising edge, it requires its input
to be stable for tₛᵤ seconds before that edge, meaning the computation
must finish early enough that, for the last tₛᵤ before the next edge,
DFF2's input is no longer changing

√ Therefore clock period must be at least long enough for the slowest
logic path to settle plus the setup-time margin. If else, we loose
correctness. Hold time is also a complementary constraint at the sampling
edge since DFF2's input must not change immediately after the edge for atleast
tₕ

=> Registers and Register Files:
- we ca

[Truncated for analysis]

### Key points

- Flip-flops need their inputs to be stable around the active clock edge.
- Setup time `tSU` is the minimum stable time before the rising edge.
- Hold time `tH` is the minimum stable time after the rising edge.
- Input changes inside the setup or hold window can cause incorrect capture.
- In a synchronous system, one flip-flop launches data and another captures it on the next edge.
- The slowest path through combinational logic is the critical path.
- Clock period must cover the critical-path delay plus setup-time margin.

### Related topics

- [[d-latch-and-edge-triggered-d-flip-flop|D Latch and Edge-Triggered D Flip-Flop]]
- [[sequential-circuits-and-clocked-storage|Sequential Circuits and Clocked Storage]]
- [[registers-and-register-files|Registers and Register Files]]

### Relationships

- depends-on: [[d-latch-and-edge-triggered-d-flip-flop|D Latch and Edge-Triggered D Flip-Flop]]
- applies-to: [[sequential-circuits-and-clocked-storage|Sequential Circuits and Clocked Storage]]
