---
title: "FPGA LUT Mapping and ASIC Standard-Cell Mapping"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 32"]
related: ["logic-synthesis-and-physical-design-flow", "verilog-as-a-hardware-description-language", "gate-level-modeling-with-verilog-modules-and-wires"]
tags: ["fpga", "lut", "flip-flops", "asic", "standard-cell", "technology-library", "gds2"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-032.png"]
---

## FPGA LUT Mapping and ASIC Standard-Cell Mapping

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 32

The notes distinguish two major digital implementation targets: FPGA and ASIC. When the target is an FPGA, the synthesis tool maps the design into lookup tables (LUTs) and flip-flops. A LUT is presented as a small configurable memory that stores the output values of a Boolean function for every input combination. A 4-input LUT can therefore implement any Boolean function of four variables by storing 16 output bits. When the target is an ASIC, synthesis instead maps the design to standard-cell gates from a technology library, such as NAND and XOR gates. Automated place-and-route then uses these mapped cells to produce the geometric layout of every transistor and wire, which becomes the GDS2 file used for manufacturing. The notes use this comparison to explain why basic gate diagrams are an abstraction rather than a literal representation of what will finally exist in silicon.

### Source snapshots

![Computer Architecture-2 Page 32](/computer-architecture/assets/computer-architecture-2-page-032.png)

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

### Key points

- FPGA logic primitives are LUTs and flip-flops.
- A LUT stores output values for all possible input combinations.
- A 4-input LUT requires 2^4 = 16 stored output bits.
- ASIC mapping uses predefined standard-cell gates from a technology library.
- Standard-cell mapping selects and connects gates to realize the required Boolean function.
- Both FPGA and ASIC flows begin from Verilog but target different primitive structures.

### Related topics

- [[logic-synthesis-and-physical-design-flow|Logic Synthesis and Physical Design Flow]]
- [[verilog-as-a-hardware-description-language|Verilog as a Hardware Description Language]]
- [[gate-level-modeling-with-verilog-modules-and-wires|Gate-Level Modeling with Verilog Modules and Wires]]

### Relationships

- contrasts-with: [[gate-level-modeling-with-verilog-modules-and-wires|Gate-Level Modeling with Verilog Modules and Wires]]
