---
title: "Finite State Machines and the Synchronous FSM Model"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 51"]
related: ["moore-and-mealy-machine-distinction", "moore-parity-checker-fsm", "rtl-modeling-for-finite-state-machines", "registers-and-register-files", "sequential-circuits-and-clocked-storage"]
tags: ["finite-state-machines", "current-state", "next-state-function", "output-function", "clock", "sequential-system"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-051-2.png"]
---

## Finite State Machines and the Synchronous FSM Model

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 51

Finite state machines (FSMs) are presented as the standard model for sequential systems whose behavior depends on both current inputs and stored internal state. Unlike purely combinational logic, a sequential system cannot be fully described by a static truth table because its outputs and future behavior depend on memory. The notes define an FSM using three parts: a set of states corresponding to all possible internal storage values, a next-state function that computes the next state from the current state and current inputs, and an output function that produces outputs from the current state and possibly the inputs. The block diagram shows the current-state register updated by the clock, feeding a next-state function and an output function, with external inputs also feeding these combinational blocks. The notes also state that the machines discussed are synchronous, meaning state changes occur in coordination with the clock and a new state is computed once per cycle.

### Source snapshots

![Computer Architecture-2 Page 51](/computer-architecture/assets/computer-architecture-2-page-051-2.png)

### Page-grounded details

#### Page 51

=> Finite State Machines

. As we saw earlier, digital logic systems can be classified as
combinational or sequential. Sequential systems contain state
stored in memory elements that is internal to the system
Their behaviour depends on:
        - set of inputs supplied
        - Contents of the internal memory (current state)
meaning they cannot be described with a truth table (?)
instead, a Sequential system is described as a finite state machine

down A finite state machine consists of:

        - A set of states which corresponds to all possible
          values of the internal storage (if there are n
          bits of storage in memory there are 2ⁿ possible states)

        - Directions on how to change the systems state, which
          are defined by a next-state function which is a
          combinational function that, given the inputs and
          the current state, determines the next state of the system,

        - An output function that produces a set of outputs
          from the current state and (maybe) the inputs


[Diagram]

A rectangular feedback loop across the top feeds from the right side back to the left into a box labeled:
Current-state
An arrow labeled "cl

[Truncated for analysis]

### Key points

- Sequential systems are described as finite state machines.
- An FSM behavior depends on current inputs and current state.
- If there are `n` bits of state storage, there are `2^n` possible states.
- The next-state function is combinational logic of current state and inputs.
- The output function depends on current state and possibly the inputs.
- The state register is updated synchronously with the clock.

### Related topics

- [[moore-and-mealy-machine-distinction|Moore and Mealy Machine Distinction]]
- [[moore-parity-checker-fsm|Moore Parity Checker FSM]]
- [[rtl-modeling-for-finite-state-machines|RTL Modeling for Finite State Machines]]
- [[registers-and-register-files|Registers and Register Files]]
- [[sequential-circuits-and-clocked-storage|Sequential Circuits and Clocked Storage]]

### Relationships

- depends-on: [[sequential-circuits-and-clocked-storage|Sequential Circuits and Clocked Storage]]
