---
title: "SR Latch and Gated SR Latch"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 42", "Page 43"]
related: ["sequential-circuits-and-clocked-storage", "d-latch-and-edge-triggered-d-flip-flop"]
tags: ["s-r-latch", "set", "reset", "gated-sr-latch", "transparent"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-042-2.png", "/computer-architecture/assets/computer-architecture-2-page-043-2.png"]
---

## SR Latch and Gated SR Latch

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 42, Page 43

The S-R latch is introduced as a fundamental state element that can remember past events. Its inputs are `S` for set and `R` for reset, and it produces outputs `Q` and typically `Q̅`. The notes give both an intuitive description and a formal truth table: `S=0,R=0` holds the previous state, `S=1,R=0` sets `Q=1`, `S=0,R=1` resets `Q=0`, and `S=1,R=1` is forbidden because it makes `Q` and `Q̅` equal, which violates their complementary meaning. A worked sequence shows that after setting the latch and then returning inputs to `S=0,R=0`, the latch keeps its remembered value. The state-transition diagram further emphasizes state retention and invalid conditions. To adapt the latch to synchronous design, the notes introduce the gated or clocked S-R latch, which allows S and R to affect the latch only when `clk=1`. Even then, the gated latch remains transparent while open, so input changes immediately influence the output during the enabled interval.

### Source snapshots

![Computer Architecture-2 Page 42](/computer-architecture/assets/computer-architecture-2-page-042-2.png)

![Computer Architecture-2 Page 43](/computer-architecture/assets/computer-architecture-2-page-043-2.png)

### Page-grounded details

#### Page 42

√ The critical concept is edge-triggered clocking; Instead of allowing
state to change at any time, state elements sample their inputs
on a clock edge, either the rising edge (0->1) or the
falling edge (1->0). Between snapshots, the stored outputs are stable
and can be used as reliable inputs to combinational logic. The output
of a state element is not immediately affected by its input, it
only changes when the element updates (eg, on a rising edge) and then
it holds that value until the next sampling event. This is called a
Synchronous system

-> A state element is a circuit component that can store one bit (or
many bits) across time. It has atleast two conceptual parts

1. A mechanism that has two stable configurations (representing 0 and 1)

2. A way to set which configuration the mechanism should be in
   based on input signals and timing.

-> State element: S-R latch
- the S-R latch is a fundamental state element. "S" stands for set
and R stands for "reset". The latch produces an output Q (and
typically also its complement Q̅, sometimes written as not Q)

[Diagram: two cross-coupled gates, upper input labeled `R` and upper output labeled `Q`; lower input labeled `S` and lower

[Truncated for analysis]

#### Page 43

- the state transition diagram of an S-R latch.

[State-transition diagram]
- Left state: circled `Q Q̅`
  `0 1`
- Right state: circled `Q Q̅`
  `1 0`
- Middle state: circled `Q Q̅`
  `0 0`
- Bottom state: circled `Q Q̅`
  `1 1`

- Self-loop on left state labeled:
  `SR=00`
  `SR=01`

- Arrow from left state to right state labeled:
  `SR=10`

- Arrow from right state to left state labeled:
  `SR=01`

- Self-loop on right state labeled:
  `SR=00`
  `SR=10`

- Around middle and upper states, additional arrows labeled:
  `01`
  `01`
  `01`
  `01`

- Self-loop on middle state labeled:
  `11(?)`

- Large outer arrows on left and right labeled:
  `11(?)`
  `11(?)`

- Cross marks `x` shown on some outer transition paths.

- Two downward arrows from middle state toward bottom state labeled:
  `00`
  `11`

- Near bottom state, labels repeated on both sides:
  `00`
  `11`

-> gated (clocked) S-R latch;

- An S-R latch changes state whenever inputs change which is a
behaviour we don't want for syncronous systems because we
want state to update only during controlled time windows

down The clocked (gated) SR latch takes the same S and R information
but only allows it to affect the latch when t

[Truncated for analysis]

### Key points

- The SR latch stores state using set and reset inputs.
- `S=0,R=0` holds the previous value.
- `S=1,R=0` sets `Q=1` and `S=0,R=1` resets `Q=0`.
- `S=1,R=1` is forbidden because it makes `Q = Q̅`.
- The latch demonstrates memory because the output depends on past actions.
- A gated SR latch only allows changes when the clock is in the open phase.
- The gated latch is transparent while enabled.

### Related topics

- [[sequential-circuits-and-clocked-storage|Sequential Circuits and Clocked Storage]]
- [[d-latch-and-edge-triggered-d-flip-flop|D Latch and Edge-Triggered D Flip-Flop]]

