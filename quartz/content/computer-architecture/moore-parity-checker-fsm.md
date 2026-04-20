---
title: "Moore Parity Checker FSM"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 52", "Page 53", "Page 54", "Page 55"]
related: ["finite-state-machines-and-the-synchronous-fsm-model", "moore-and-mealy-machine-distinction", "rtl-modeling-for-finite-state-machines"]
tags: ["moore-machine", "parity-checker", "even", "odd", "d-flip-flop", "xor", "transition-table"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-052-2.png", "/computer-architecture/assets/computer-architecture-2-page-053-2.png"]
---

## Moore Parity Checker FSM

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 52, Page 53, Page 54, Page 55

The notes develop a complete Moore FSM example that checks parity over a 1-bit input stream `i`. The required output is `o = 1` if and only if the number of `1`s seen so far is odd. Because this is a Moore machine, the output depends only on the current state: state EVEN produces `o = 0`, while state ODD produces `o = 1`. The key design insight is that the machine does not need to remember the exact count of ones, only whether the count is currently even or odd, so one bit of state is sufficient. Transitions are determined by the incoming bit: input `0` leaves the parity unchanged, while input `1` toggles between EVEN and ODD. The notes then present the state diagram, transition table, bit-level truth table, and derived Boolean equations `D = i ⊕ Q` and `o = Q`, where `D` is the next-state input to a D flip-flop and `Q` is the current state output.

### Source snapshots

![Computer Architecture-2 Page 52](/computer-architecture/assets/computer-architecture-2-page-052-2.png)

![Computer Architecture-2 Page 53](/computer-architecture/assets/computer-architecture-2-page-053-2.png)

### Page-grounded details

#### Page 52

down When a finite state machine is used as a controller, the output
function is often restricted to depend on just the current State,
Such a FSM is called a Moore Machine

down If the output function can depend on both the current state
and the current input, the machine is called a Mealy Machine

down These two machines are equivalent in their capabilities and one can be
turned into another mechanically however the basic advantage of a
Moore machine is that it can have a faster [unclear], while a Mealy Machine
can be smaller and have a faster reaction time

a) Moore Machines
. A finite state Machine can be implemented with a temporary
register that holds the current State and a block of
combinational logic that determines the output.

input
down
-> -> -> into box labeled:
"combinational
logic for
next state"

From this box, arrows go right into a narrow vertical register block labeled
"register"
Outputs from the register go right into a second box labeled:
"combinational
logic for
outputs"
From this second box, arrows go right and are labeled output.
Several feedback lines loop from the register outputs back to the left, into the
first box ("combinational logic for next state").

[Truncated for analysis]

#### Page 53

Because this is a moore machine, the defining constraint is

up output function
O = g(Q)  (output depends only on the current state)

up next state function
Q⁺ = f´(Q, i)  (next state depends on current state and input)

down Where, Q denotes the current state (the value stored in the state
register), and Q⁺ denotes the next state (the value that will be
stored after the next clock edge)

↳ A state should store exactly the "memory of the past"
that is necessary to produce correct future behaviour. For
parity, we dont need the exact count of ones, we only
need whether the count so far is even or odd, which is
a single bit information, meaning there are exactly two
meaningfull situations

- Even  The number of 1s seen so far is even

- ODD: The number of 1s seen so far is odd

Because this is a Moore machine, we attach the output to the state:

- In state EVEN, the correct output is O = 0

- In state ODD, the correct output is O = 1

Now we decide how input i moves the machine between states.

↳ Receiving a 0 does not change the number of ones seen so far -> parity doesnt
change

↳ Receiving a 1 increases the number of ones by one -> parity toggles

#### Page 54

So the transitions are

↳ from Even
  - if i = 0, stay in Even
  - if i = 1, go to ODD

↳ from ODD
  - if i = 0, stay in ODD.
  - if i = 1, go to Even

From these, we can construct a state diagram representing
the FSM;

[State diagram]
- Two states drawn as circles:
  - Top circle labeled:
    EVEN
    [0]
  - Bottom circle labeled:
    ODD
    [1]
- An incoming arrow points to the EVEN state from the left, indicating the initial state.
- A self-loop on EVEN labeled 0.
- A self-loop on ODD labeled 0.
- A curved arrow from EVEN down to ODD labeled 1.
- A curved arrow from ODD up to EVEN labeled 1.

○   States

xyz   state name

LUV   outputs uv,
      ↳ Depends only on state for
        moore machines

i is ->   State transition caused
         by changing the input

↳   initial state

A FSM can also be represented by a Transition Table

        Q     i     Q⁺     o
        EVEN  0     EVEN   0
        EVEN  1     ODD    0
        ODD   0     ODD    1
        ODD   1     EVEN   1

(Because it's moore, the output
column is determined solely
by Q, NOT i)

OR a "truth table" where D
represents a D flip flop as the
state register.

            Bit representation
              down

[Truncated for analysis]

#### Page 55

From the truth table we can directly infer the
boolean expression and the actual gate level implementation

D = i ⊕ Q
o = Q

[Diagram: an XOR gate takes inputs `Q` (feedback from the flip-flop output) and `i`; its output feeds `D` of a D flip-flop. The flip-flop output is labeled `Q` and goes to `o`. A feedback wire from `Q` loops back to the XOR input. Labels under the drawing: `Next state` under the XOR/`D` input side, `clk` under the clock input arrow to the flip-flop, and `current state` near the `Q` output/feedback side.]

In verilog, we most often describe hardware in RTL (register-
transfer level) meaning we describe the hardware as:

1. Registers (state elements) that update on a clock edge, and

2. Combinational logic that computes                            (Next state)
   - The next value to load into those registers, and
   - the outputs

RTL is a subset of behavioral verilog that can be automatically
translated (synthesized) to a gate level description

[Flow diagram, vertical boxes with downward arrows:]
RTL behavioral
Verilog description
down
RTL Synthesis
Tool
down
gate-level
verilog description
down
Place & Route
Tool
down
GDS2 text
file

module Moore FSM (
    inp

[Truncated for analysis]

### Key points

- The FSM outputs `1` when the number of received `1`s so far is odd.
- Only two states are needed: EVEN and ODD.
- In a Moore machine, output is attached to state: EVEN gives `0`, ODD gives `1`.
- Input `0` preserves the current parity state.
- Input `1` toggles between EVEN and ODD.
- The transition table can be encoded using one state bit `Q`.
- The derived next-state equation is `D = i ⊕ Q`.
- The output equation is `o = Q`.

### Related topics

- [[finite-state-machines-and-the-synchronous-fsm-model|Finite State Machines and the Synchronous FSM Model]]
- [[moore-and-mealy-machine-distinction|Moore and Mealy Machine Distinction]]
- [[rtl-modeling-for-finite-state-machines|RTL Modeling for Finite State Machines]]

### Relationships

- example-of: [[moore-and-mealy-machine-distinction|Moore and Mealy Machine Distinction]]
- applies-to: [[rtl-modeling-for-finite-state-machines|RTL Modeling for Finite State Machines]]
