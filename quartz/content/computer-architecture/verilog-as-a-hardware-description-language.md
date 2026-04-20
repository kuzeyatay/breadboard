---
title: "Verilog as a Hardware Description Language"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 32", "Page 33", "Page 34"]
related: ["logic-synthesis-and-physical-design-flow", "gate-level-modeling-with-verilog-modules-and-wires", "behavioral-modeling-and-continuous-assignment", "test-benches-and-stimulus-generation"]
tags: ["verilog", "hdl", "compiler", "verilog-simulator", "waveform", "alu", "parallel"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-032.png", "/computer-architecture/assets/computer-architecture-2-page-033.png"]
---

## Verilog as a Hardware Description Language

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 32, Page 33, Page 34

The notes motivate Verilog by explaining that manually drawing hardware at the gate level becomes infeasible once systems grow to the size of an ALU or a small processor. Verilog is introduced as a hardware description language that lets the designer write what the hardware should do in text form, after which synthesis translates the design into LUTs or standard cells depending on the target technology. A central conceptual comparison is made between C and Verilog. A C program is compiled into an executable that runs sequentially on hardware, whereas a Verilog description is simulated or synthesized as a hardware design that operates in parallel. The notes explicitly state that textual order in Verilog does not impose a sequential execution order in the way it does in C. This topic is foundational because it connects hardware abstraction, simulation, synthesis, and the inherently parallel nature of digital circuits.

### Source snapshots

![Computer Architecture-2 Page 32](/computer-architecture/assets/computer-architecture-2-page-032.png)

![Computer Architecture-2 Page 33](/computer-architecture/assets/computer-architecture-2-page-033.png)

### Page-grounded details

#### Page 32

down If the Target technology is an FPGA , the synthesis tool maps
the design onto lookup tables (LUTs) and flip flops which are
the logic primitives of FPGA's. A Lut is a small configurable
memory block that stores the output values of a boolean function
for all possible input combinations. For example, a 4 input LUT
can implement any boolean function of four variables by
storing (2^0) 2^4 = 16 output bits internally. [BR unused since its
basically a programmable IC]

↳ If the target is an ASIC , the tool maps the logic onto
Standard-cell gates such as NAND, XOR ... from a technology
library. Mapping to standard cells means selecting and connecting
these predefined gates so that the final chip implements the
required boolean function, The final physical design is represented
by a GDS2 file , which describes the exact geometric layout
of every transistor and wire in every fabrication layer . Automated
place and route tools generate this layout from the synthesized
netlist, producing the mask data used to manufacture the
silicon die.

=> The verilog Hardware Description Language:
- If you try to build a moderately complex system such as an
ALU or a small processor , drawing individu

[Truncated for analysis]

#### Page 33

- in a C program

[a vertical flow diagram]
[a C program]
down
compiler
down
executable
down
inputs -> computer (Hardware) -> Out put (results)

- Sequential

- a verilog description for FPGA (Simulation)

[a vertical flow diagram]
verilog simulator
(C source cod)
down
compiler
down
executable
program
verilog simulator.exe
down
verilog design
+ stimuli waveform
(testbench) -> Computer
(Hardware) -> Out put
waveform

- Parallel

#### Page 34

- a verilog description for ASIC (manufacturing)

[Diagram]
[a C program
(place & route tool)]
down
[compiler]
down
[executable
(P&R tool).exe]
down
[input:
verilog
design] -> [Computer
(hardware)] -> [output:
GDS2 text file]
                                     down
                              [chip factory
                              "fab"]
                                     down
[input:
stimuli (test)] -> [chip
(IC)] -> [output:
observed
results]

-> In verilog (or essentially in any circuit) there are two fundamentally
different ways of describing what an IC does:

1. By describing its structure (what components exist and
   how they are connected).

2. By describing its behaviour (what outputs result
   from given inputs)

### Key points

- Verilog is needed when gate-by-gate drawing becomes infeasible.
- Verilog describes hardware in text rather than drawing literal gates.
- Verilog descriptions are synthesized into LUTs or standard cells depending on the target.
- C programs execute sequentially after compilation.
- Verilog hardware operates in parallel rather than as a sequential program.
- Verilog can also be simulated using a testbench and waveform outputs.

### Related topics

- [[logic-synthesis-and-physical-design-flow|Logic Synthesis and Physical Design Flow]]
- [[gate-level-modeling-with-verilog-modules-and-wires|Gate-Level Modeling with Verilog Modules and Wires]]
- [[behavioral-modeling-and-continuous-assignment|Behavioral Modeling and Continuous Assignment]]
- [[test-benches-and-stimulus-generation|Test Benches and Stimulus Generation]]

### Relationships

- part-of: [[gate-level-modeling-with-verilog-modules-and-wires|Gate-Level Modeling with Verilog Modules and Wires]]
- part-of: [[behavioral-modeling-and-continuous-assignment|Behavioral Modeling and Continuous Assignment]]
