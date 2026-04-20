---
title: "Moore and Mealy Pattern Detector for Two Consecutive Ones"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 59"]
related: ["moore-and-mealy-timing-and-combinational-path-tradeoffs"]
tags: ["moore", "mealy", "state-machine", "pattern-detection", "output", "transition"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-059-2.png"]
---

## Moore and Mealy Pattern Detector for Two Consecutive Ones

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 59

The notes design two state machines for a 1-output detector that asserts when at least the last two inputs read were 1s. The Moore solution uses three states because output depends only on the current state. The top state represents no recent 1s, the middle state represents having just seen one 1, and the bottom state represents the accepting condition where the last two inputs are 1s. Transitions reflect whether the next input is 0 or 1, with the accepting state looping on input 1 so the detector continues asserting when more 1s arrive. The Mealy solution uses only two states because output can depend on both state and current input. In that design, the machine stays in the 0-state on input 0 with output 0, moves to the 1-state on input 1 with output 0, returns to the 0-state on input 0 with output 0, and loops in the 1-state on input 1 with output 1. The notes explicitly compare the two styles: Mealy machines usually need fewer states and react faster to inputs, while Moore machines have simpler timing because outputs are separated from immediate input changes.

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

- The detector output should assert when the last two inputs were both 1.
- The Moore implementation uses three states.
- The Mealy implementation uses two states.
- In the Moore machine, output is associated with states rather than transitions.
- In the Mealy machine, transition labels use input/output form such as 1/1.
- The accepting Moore state loops on input 1 to keep detection active during runs of 1s.
- The Mealy detector produces output 1 immediately on a 1 received while already in the state representing a previous 1.

### Related topics

- [[moore-and-mealy-timing-and-combinational-path-tradeoffs|Moore and Mealy Timing and Combinational Path Tradeoffs]]

### Relationships

- depends-on: [[moore-and-mealy-timing-and-combinational-path-tradeoffs|Moore and Mealy Timing and Combinational Path Tradeoffs]]
