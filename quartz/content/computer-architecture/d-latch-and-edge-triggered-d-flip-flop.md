---
title: "D Latch and Edge-Triggered D Flip-Flop"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 44", "Page 45"]
related: ["sequential-circuits-and-clocked-storage", "sr-latch-and-gated-sr-latch", "setup-time-hold-time-and-critical-path-timing"]
tags: ["d-latch", "d-flip-flop", "master", "slave", "clk", "transparent"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-044-2.png", "/computer-architecture/assets/computer-architecture-2-page-045-2.png"]
---

## D Latch and Edge-Triggered D Flip-Flop

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 44, Page 45

The D latch is introduced as a simplification of the clocked S-R latch. Instead of separate set and reset controls, it stores a single data input `D` when enabled. When `clk=1`, the D latch is open and copies `D` to `Q`; when `clk=0`, it holds its previous value. Because it is transparent while enabled, changes on `D` immediately appear at `Q` during the open interval. This transparency is useful but also means the D latch samples over a time window rather than a single instant. To solve that, the notes present the rising-edge-triggered D flip-flop as a master-slave pair of D latches driven by opposite clock phases. The master latch responds when the clock is low, while the slave responds when the clock is high, so the final output `Q` changes only at the rising edge. This produces the desired behavior of sampling input at a single edge and holding it for the rest of the cycle.

### Source snapshots

![Computer Architecture-2 Page 44](/computer-architecture/assets/computer-architecture-2-page-044-2.png)

![Computer Architecture-2 Page 45](/computer-architecture/assets/computer-architecture-2-page-045-2.png)

### Page-grounded details

#### Page 44

=> The D latch

- A clocked S-R latch is still awkward, because it has two control
inputs (S and R) and still ontains the forbidden input condition.
In most designs, you want to store a single-bit value D: ("data") and
have the latch store that bit exactly when enabled.

[Diagram: A gate-level D latch circuit.
- Left inputs labeled `D` (upper) and `CLK` (lower).
- `D` feeds two gates; the upper gate has a small inversion bubble on its input.
- `CLK` also feeds the gating network.
- The two gated outputs are labeled `D` (upper path) and `D̅` (lower path).
- These drive a cross-coupled pair of NOR-like gates on the right.
- Output from the upper right gate is labeled `Q`.
- Cross-coupled feedback lines connect the two right-side gates.]

[Timing sketch below diagram:
- A square-wave clock waveform is drawn.
- Above the first high pulse is a double-headed horizontal arrow labeled `open`.
- Above a later high pulse is a left-pointing arrow labeled `closed`.
- Note at right: `* D latch is enabled`
  `when clk = 1 and`
  `disabled when clk = 0`]

down when its enabled, it copies the input bit D to the output Q
when its not enabled it keeps Q unchanged and its transparent while
its open (

[Truncated for analysis]

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

### Key points

- A D latch stores a single-bit input `D` when enabled.
- When `clk=1`, the D latch is open and transparent.
- When `clk=0`, the D latch holds its previous output.
- A D latch samples over an interval, not a single instant.
- A rising-edge D flip-flop can be built from master and slave D latches in series.
- The master and slave are driven so they are never transparent at the same time.
- The flip-flop output changes only on the rising edge.

### Related topics

- [[sequential-circuits-and-clocked-storage|Sequential Circuits and Clocked Storage]]
- [[sr-latch-and-gated-sr-latch|SR Latch and Gated SR Latch]]
- [[setup-time-hold-time-and-critical-path-timing|Setup Time, Hold Time, and Critical Path Timing]]

### Relationships

- derives-from: [[sr-latch-and-gated-sr-latch|SR Latch and Gated SR Latch]]
