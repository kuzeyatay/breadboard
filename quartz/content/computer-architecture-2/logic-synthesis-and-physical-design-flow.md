---
title: "Logic Synthesis and Physical Design Flow"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 31", "Page 32", "Page 34", "Page 55"]
related: ["integrated-circuits-and-digital-chip-categories", "fpga-lut-mapping-and-asic-standard-cell-mapping", "verilog-as-a-hardware-description-language", "rtl-modeling-for-finite-state-machines"]
tags: ["logic-synthesis", "verilog", "rtl", "netlist", "place-and-route", "gds2", "standard-cell", "fabrication"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-031.png", "/computer-architecture/assets/computer-architecture-2-page-032.png"]
---

## Logic Synthesis and Physical Design Flow

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 31, Page 32, Page 34, Page 55

Modern chip design begins from a hardware description written in a hardware description language such as Verilog. The notes stress that HDL text does not define execution order the way C does; instead, it defines hardware structure, behavior, and signal relationships. A synthesis tool reads the RTL description, optimizes it, and maps it onto the minimal logic primitives available in the target technology. The output of synthesis is a gate-level netlist, which is a list of logic primitives and the connections between them. A place-and-route tool then takes that netlist and decides where each cell should be placed on silicon, how to route the interconnect, and whether timing and physical constraints are satisfied. The final result is a GDS2 file, which describes the chip layout used by the fabrication plant. This topic captures the design pipeline from HDL through synthesis, netlist generation, place and route, and manufacturing data preparation.

### Source snapshots

![Computer Architecture-2 Page 31](/computer-architecture/assets/computer-architecture-2-page-031.png)

![Computer Architecture-2 Page 32](/computer-architecture/assets/computer-architecture-2-page-032.png)

### Page-grounded details

#### Page 31

----
[small sketch/mark in upper-left margin]

[margin note at top right with arrow pointing to "chip":] chip is an informal name for IC's

- At the heart of every computer is a chip / Integrated circuit (IC)
which physically consists of a small silicon piece that contains billions of
transistors and wires named the die . The die is inside something called a
Package that protects the die and provides input and output pins so
the chip can be connected to a mother board , an arduino board or a
car controller . Inside the die , transistors and wires implement
logic gates such as AND, OR and NOT, as well as memory elements
such as registers and RAM, which are the physical realizations of
the boolean functions.

Integrated Circuits
[diagram: title "Integrated Circuits" centered, with a branching brace/arrow structure splitting into "Analog Integrated Circuits" on the left and "Digital integrated Circuits" on the right]

Analog Integrated Circuits
↳ Amplifiers
↳ Voltage Regulators
↳ Analog Filters

Digital integrated Circuits
[diagram: "Digital integrated Circuits" branches into three categories]

Fixed function IC's
↳ Microprocessors (CPU's)
↳ Microcontrollers (MCU's)
↳ GPU's
↳ Memory c

[Truncated for analysis]

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

- Chip design starts from a textual HDL specification such as Verilog.
- HDL order describes signal structure and relationships rather than program execution order.
- Synthesis converts RTL behavior into logic primitives provided by the target IC technology.
- The synthesis output is a gate-level netlist.
- Place and Route places cells, routes wires, and checks timing and physical rules.
- The fabrication-ready result is a GDS2 file.

### Related topics

- [[integrated-circuits-and-digital-chip-categories|Integrated Circuits and Digital Chip Categories]]
- [[fpga-lut-mapping-and-asic-standard-cell-mapping|FPGA LUT Mapping and ASIC Standard-Cell Mapping]]
- [[verilog-as-a-hardware-description-language|Verilog as a Hardware Description Language]]
- [[rtl-modeling-for-finite-state-machines|RTL Modeling for Finite State Machines]]

### Relationships

- depends-on: [[verilog-as-a-hardware-description-language|Verilog as a Hardware Description Language]]
- applies-to: [[fpga-lut-mapping-and-asic-standard-cell-mapping|FPGA LUT Mapping and ASIC Standard-Cell Mapping]]
