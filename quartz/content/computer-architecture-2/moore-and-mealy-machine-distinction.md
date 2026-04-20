---
title: "Moore and Mealy Machine Distinction"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 52", "Page 58"]
related: ["finite-state-machines-and-the-synchronous-fsm-model", "moore-parity-checker-fsm", "vending-machine-moore-fsm-design"]
tags: ["moore-machine", "mealy-machine", "output-function", "next-state", "register", "combinational-logic"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-052-2.png", "/computer-architecture/assets/computer-architecture-2-page-058-2.png"]
---

## Moore and Mealy Machine Distinction

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 52, Page 58

The notes distinguish two standard FSM output models. In a Moore machine, the output function depends only on the current state. In a Mealy machine, the output function depends on both the current state and the current input. The notes emphasize that the two forms are equivalent in capability and can be transformed into one another mechanically. However, they differ in practical tradeoffs: a Moore machine is described as having an advantage related to output timing simplicity, while a Mealy machine can be smaller and can react faster because outputs can respond immediately to input changes without waiting for a state transition. The Moore implementation structure shown includes a state register, combinational logic for next state, and separate combinational logic for outputs derived from the register contents. The Mealy structure instead combines output and next-state combinational logic together from the inputs and current state.

### Source snapshots

![Computer Architecture-2 Page 52](/computer-architecture/assets/computer-architecture-2-page-052-2.png)

![Computer Architecture-2 Page 58](/computer-architecture/assets/computer-architecture-2-page-058-2.png)

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

#### Page 58

I Third design: To avoid losing money while staying moore type,
the state machine must remember both how much credit is stored and
whether coffee is being produced with what credit remains afterwards,
Thus the states are now:

- 0c - C [0]    (0 cent, no coffee)
- 5c - C [0]
- 10c - C [0]
- 15c - C [0]
- 0c + C [1]    (10 cent remaining, coffee)
- 5c + C [1]    (5 cent remaining, coffee)

[State diagram at right:]

- State bubble: `0c-C` / `[0]`
  - self-loop labeled `00`
  - incoming start arrow from left
  - downward arrow to `5c-C [0]` labeled `10`
  - curved arrow downward/right labeled `01`
  - large outer curved arrow returning into this state labeled `00`

- State bubble: `5c-C` / `[0]`
  - downward arrow to `10c-C [0]`
  - incoming diagonal arrow from `5c+C [1]` labeled `00`
  - curved transitions between this state and lower states labeled `01`

- State bubble: `10c-C` / `[0]`
  - self-loop labeled `00`
  - downward arrow to `10c+C [1]` labeled `10`
  - diagonal arrows to/from `5c+C [1]` labeled `10` and `01`
  - curved transitions involving `5c-C [0]` and `10c+C [1]` labeled `01`

- State bubble: `5c+C` / `[1]`
  - diagonal arrow up to `5c-C [0]` labeled `00`
  - diagonal

[Truncated for analysis]

### Key points

- Moore machine outputs depend only on the current state.
- Mealy machine outputs depend on the current state and current input.
- Both machine types are equivalent in expressive capability.
- A Moore machine separates output logic from next-state logic through the state register.
- A Mealy machine can often use fewer states or respond faster.
- The distinction affects how outputs are attached in diagrams, tables, and RTL.

### Related topics

- [[finite-state-machines-and-the-synchronous-fsm-model|Finite State Machines and the Synchronous FSM Model]]
- [[moore-parity-checker-fsm|Moore Parity Checker FSM]]
- [[vending-machine-moore-fsm-design|Vending Machine Moore FSM Design]]

### Relationships

- part-of: [[finite-state-machines-and-the-synchronous-fsm-model|Finite State Machines and the Synchronous FSM Model]]
