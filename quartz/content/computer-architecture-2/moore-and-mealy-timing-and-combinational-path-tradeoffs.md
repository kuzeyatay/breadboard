---
title: "Moore and Mealy Timing and Combinational Path Tradeoffs"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 59"]
related: ["moore-and-mealy-pattern-detector-for-two-consecutive-ones", "single-cycle-processor-datapath-and-control-overview"]
tags: ["moore", "mealy", "combinational-logic", "registers", "timing", "next-state"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-059-2.png"]
---

## Moore and Mealy Timing and Combinational Path Tradeoffs

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 59

The notes compare Moore and Mealy implementations at the structural hardware level. For Moore machines, the block diagrams separate the combinational logic for next state from the combinational logic for outputs, with the state registers in between. This means outputs depend only on the registered state, which limits the number of gates in the combinational output path and makes timing easier to control. For Mealy machines, the next-state logic and output logic are combined, and the outputs also depend directly on inputs. Because of that direct dependency, the combinational path can become deep or effectively unbounded in the notes' wording, making timing analysis more complex. The tradeoff summarized by the pages is classic: Moore machines often consume more states but have cleaner synchronous behavior, while Mealy machines can respond within the same cycle to input changes and often require fewer states. The diagrams reinforce that the key distinction is whether outputs are generated only from state or from state plus current input.

### Source snapshots

![Computer Architecture-2 Page 59](/computer-architecture/assets/computer-architecture-2-page-059-2.png)

### Page-grounded details

#### Page 59

✓ design a moore and a mealy state machine for a 1
output pattern detection circuit that asserts its output when
atleast the last two inputs read were 1s

Solution          Moore                     Mealy

Moore diagram:
- Three states drawn vertically, each state circled.
- Top state labeled:
  0
  00
- Middle state labeled:
  1
  01
- Bottom state labeled:
  11
  10
- Incoming start arrow points to the top state.
- Top state has a self-loop labeled `0`.
- Transition from top state down to middle state labeled `1`.
- Transition from middle state down to bottom state labeled `1`.
- Curved transition from middle state back to top state labeled `0`.
- Curved transition from bottom state back up to middle/top path labeled `0` [arrow points upward].
- Bottom state has a self-loop labeled `1`.

Mealy diagram:
- Two states drawn vertically, each state circled.
- Top state labeled:
  0
- Bottom state labeled:
  1
- Incoming start arrow points to the top state.
- Top state has a self-loop labeled `0/0`.
- Transition from top state down to bottom state labeled `1/0` `(input/output)`
- Curved transition from bottom state back to top state labeled `0/0`.
- Bottom state has a self-loop labeled

[Truncated for analysis]

### Key points

- Moore outputs are generated from registered state.
- Mealy outputs depend on current input as well as state.
- Moore machines limit the combinational path to the output logic after the registers.
- Mealy machines can have deeper output logic because input affects output directly.
- Mealy designs often react faster than Moore designs.
- Moore timing is generally easier to manage.

### Related topics

- [[moore-and-mealy-pattern-detector-for-two-consecutive-ones|Moore and Mealy Pattern Detector for Two Consecutive Ones]]
- [[single-cycle-processor-datapath-and-control-overview|Single-Cycle Processor Datapath and Control Overview]]

### Relationships

- related: [[single-cycle-processor-datapath-and-control-overview|Single-Cycle Processor Datapath and Control Overview]]
