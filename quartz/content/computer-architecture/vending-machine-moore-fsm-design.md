---
title: "Vending Machine Moore FSM Design"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 57", "Page 58"]
related: ["finite-state-machines-and-the-synchronous-fsm-model", "moore-and-mealy-machine-distinction", "moore-parity-checker-fsm"]
tags: ["vending-machine", "moore-machine", "state-diagram", "coffee", "credit", "10c"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-057-2.png", "/computer-architecture/assets/computer-architecture-2-page-058-2.png"]
---

## Vending Machine Moore FSM Design

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 57, Page 58

The vending-machine example designs a Moore FSM controller that accepts `5c` and `10c` coins and outputs coffee once at least `15c` has been collected. Inputs are encoded as `00` for no coin, `10` for `5c`, `01` for `10c`, and `11` as invalid. The first design uses states `0c`, `5c`, `10c`, and `>=15c [1]`, but the coffee state has a self-loop on valid inputs, which would cause the machine to keep producing coffee continuously once it reaches that state. The second design returns from the coffee state to `0c`, eliminating continuous free output, but this loses leftover credit after overpayment. The third design preserves Moore-machine structure while remembering remaining credit by expanding the state set to distinguish coffee-producing states with residual balance, such as `0c + C [1]` and `5c + C [1]`. The example teaches a general design principle: state choices must encode enough past information to preserve required future behavior.

### Source snapshots

![Computer Architecture-2 Page 57](/computer-architecture/assets/computer-architecture-2-page-057-2.png)

![Computer Architecture-2 Page 58](/computer-architecture/assets/computer-architecture-2-page-058-2.png)

### Page-grounded details

#### Page 57

Mealy/Moore vending machine FSM

- This example designs a Moore type controller for a vending machine that
accepts 5c and 10c coins and outputs coffee once the machine has received
at last 15c. The inputs are

    - 00 -> no coin inserted
    - 10 -> 5c coin inserted
    - 01 -> 10c coin inserted
    - 11 -> invalid input

First design.

[State diagram at left]
- Initial arrow points to circled state: `0c`
  `[0]`
- Self-loop on `0c [0]` labeled `00`
- Arrow from `0c [0]` down to circled state `5c`
  `[0]`
  labeled `10`
- Curved arrow from `0c [0]` down/right to circled state `10c`
  `[0]`
  labeled `01`
- Self-loop on `5c [0]` labeled `00`
- Arrow from `5c [0]` down to circled state `10c`
  `[0]`
  labeled `10`
- Curved arrow from `5c [0]` down/right to circled state `>=15c`
  `[1]`
  labeled `01`
- Self-loop on `10c [0]` labeled `00`
- Arrow from `10c [0]` down to circled state `>=15c`
  `[1]`
  labeled `10,01`
- Self-loop on `>=15c [1]` labeled `00,10,01`

-> However in this diagram, once the machine
reaches the state `>=15c [1]`, it has a self
loop labeled with 00,10,01 meaning that
after reaching >=15c, it stays in the >=15c
state for all valid inputs, implying that
after the

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

- The machine is a Moore controller for coffee dispensing at 15 cents or more.
- Input encoding is `00` no coin, `10` 5 cents, `01` 10 cents, `11` invalid.
- A naive `>=15c` coffee state with a self-loop causes repeated free coffee.
- Returning directly to `0c` after coffee avoids repeated output but loses leftover credit.
- A better Moore design adds states that encode both coffee output and remaining credit.
- Expanded states preserve overpayment information while keeping output state-based.

### Related topics

- [[finite-state-machines-and-the-synchronous-fsm-model|Finite State Machines and the Synchronous FSM Model]]
- [[moore-and-mealy-machine-distinction|Moore and Mealy Machine Distinction]]
- [[moore-parity-checker-fsm|Moore Parity Checker FSM]]

### Relationships

- example-of: [[moore-and-mealy-machine-distinction|Moore and Mealy Machine Distinction]]
- applies-to: [[finite-state-machines-and-the-synchronous-fsm-model|Finite State Machines and the Synchronous FSM Model]]
- related: [[moore-parity-checker-fsm|Moore Parity Checker FSM]]
