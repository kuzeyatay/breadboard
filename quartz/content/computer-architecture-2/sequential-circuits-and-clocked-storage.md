---
title: "Sequential Circuits and Clocked Storage"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 41", "Page 42"]
related: ["sr-latch-and-gated-sr-latch", "d-latch-and-edge-triggered-d-flip-flop", "setup-time-hold-time-and-critical-path-timing"]
tags: ["sequential-circuits", "clock", "clock-period", "clock-frequency", "rising-edge", "falling-edge", "synchronous-system", "state-element"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-041-2.png", "/computer-architecture/assets/computer-architecture-2-page-042-2.png"]
---

## Sequential Circuits and Clocked Storage

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 41, Page 42

The notes define sequential logic as combinational logic plus state elements, with a clock regulating when stored state is sampled and updated. A clock is described as a periodic digital signal alternating between 0 and 1, with period `T` and frequency `f = 1/T`. The core concept is edge-triggered clocking: state elements sample inputs only on specific clock edges, such as the rising edge or falling edge, and remain stable between those edges. This stability allows combinational logic to operate on dependable inputs during the interval between state updates, creating a synchronous system. The notes also define a state element abstractly as a mechanism with two stable configurations and a way to choose between them based on input signals and timing. This material establishes the timing discipline behind synchronous digital design and motivates the need for latches and flip-flops.

### Source snapshots

![Computer Architecture-2 Page 41](/computer-architecture/assets/computer-architecture-2-page-041-2.png)

![Computer Architecture-2 Page 42](/computer-architecture/assets/computer-architecture-2-page-042-2.png)

### Page-grounded details

#### Page 41

initial begin
    in1 = 0
    in2 = 0
end
                              } initialize is another procedural block

always #100  in1 = ~ in1
always # 50  in2 = ~ in2
                              } means run every x nanosecond forever. In here
                                we invert in1 every 100ns and in2 every
                                50ns

endmodule

if you want the testbench to stop instead of runing forever

    initial begin
            #400 $ finish;    // Stops simulation after 400ns
    end

Lecture 2 week 2

=> Sequential Circuits

- In contrast to combinational logic, A sequential circuit has "state"
  meaning the circuit contains one or more storage elements that hold
  bits from the past, and those stored bits influence what the circuit
  does next. Compactly ; Sequential logic = combinational logic + state
  elements, and a clock is used to regulate when the state elements
  sample and update

- A Clock is a periodic digital signal, ideally alternating between 0 and 1
    - Clock Period: The time for one full cycle, in second's
    - Clock Frequency: The number of cycles per second (Hz)  f = 1/T

[Diagram: a square-wave clock signal drawn left to right. The fir

[Truncated for analysis]

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

### Key points

- Sequential logic combines combinational logic with state elements.
- A clock regulates when state elements sample and update.
- Clock period is the time for one full cycle.
- Clock frequency is `f = 1/T`.
- Edge-triggered systems update state only on clock edges.
- Between edges, stored outputs remain stable and feed combinational logic.
- A synchronous system depends on this edge-based update discipline.

### Related topics

- [[sr-latch-and-gated-sr-latch|SR Latch and Gated SR Latch]]
- [[d-latch-and-edge-triggered-d-flip-flop|D Latch and Edge-Triggered D Flip-Flop]]
- [[setup-time-hold-time-and-critical-path-timing|Setup Time, Hold Time, and Critical Path Timing]]

### Relationships

- part-of: [[sr-latch-and-gated-sr-latch|SR Latch and Gated SR Latch]]
- part-of: [[d-latch-and-edge-triggered-d-flip-flop|D Latch and Edge-Triggered D Flip-Flop]]
