---
title: "Gate-Level Modeling with Verilog Modules and Wires"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 35", "Page 36"]
related: ["verilog-as-a-hardware-description-language", "behavioral-modeling-and-continuous-assignment", "fpga-lut-mapping-and-asic-standard-cell-mapping"]
tags: ["gate-level-modeling", "module", "wire", "not", "xor", "half-adder"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-035.png", "/computer-architecture/assets/computer-architecture-2-page-036.png"]
---

## Gate-Level Modeling with Verilog Modules and Wires

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 35, Page 36

Gate-level modeling describes a circuit explicitly in terms of its component gates and the wires that connect them. The notes introduce the Verilog module as the basic container for hardware, with input and output ports and internal wiring. A half-adder example is used to show a module declaration and its interface. Inside the module, internal connections are declared using `wire`, which represents a physical connection rather than a storage element. The notes then list built-in Verilog gate primitives such as `and`, `nand`, `or`, `nor`, `not`, `xor`, and `xnor`, together with the instantiation syntax `gate_type instance_name(output, input1, input2)`. The half-adder is constructed from NOT, AND, and OR gates with intermediate wires like `not1_out`, `not2_out`, `and1_out`, and `and2_out`. This modeling style is structurally close to the actual circuit, making it relatively direct to translate into layout, but it becomes impractical for large designs.

### Source snapshots

![Computer Architecture-2 Page 35](/computer-architecture/assets/computer-architecture-2-page-035.png)

![Computer Architecture-2 Page 36](/computer-architecture/assets/computer-architecture-2-page-036.png)

### Page-grounded details

#### Page 35

1. Gate-level modeling : Describing structure ;

- Gate level modeling means explicitly writing down which logic gates
exist and how they are connected. To do that in verilog we must
first understand the container in which hardware is defined.

➜ Every verilog design is built from modules : A module represents a hardware
block. it has input terminals and output terminals. it contains
internal wiring and logic.

The general structure is:

        module name (ports);
                // describe internal hardware
        endmodule.

\ex/

        module halfadder1(
                input a,
                input b,
                output sum,
                output carry,
        );
                // Stuff ...
        endmodule

[diagram: arrow pointing right to a rectangular block labeled "half adder 1"; inputs on left labeled "a" and "b"; outputs on right labeled "Sum" and "carry"]

➜ inside a module, Signals must connect gates to each other which corresponds
to metal wires in hardware. In verilog, these are declared as:

        wire Signal name;

They only represent a physical connection and they don't store information

\ex/      // Stuff:

        wire Not1-Out;
        wire oo

[Truncated for analysis]

#### Page 36

-> Verilog includes built-in logic primitives as:

- and                           - nand

- or                            - nor

- not                           - xor

                                 - xnor


That represent actual logic gates. The syntax for instantiating
a gate is:

gate_type  instance_name  ( output, input 1, input 2 )

[above the terms are handwritten labels with arrows pointing down:]
wire        wire        wire
[below `output` there is a handwritten note with an arrow:]
output first


Ex/   //such:
      //...

not not1(not1_out, a);
and and1(and1_out, not1_out, b);
not not2(not2_out, b),
and and2(and2_out, a, not2_out);
or  or1(sum, and1_out, and2_out);
and and3(carry, a, b);

[diagram at right of the example: a gate-level half-adder drawing]
- inputs labeled `a` and `b` enter from the left
- top branch: `a` goes through an inverter labeled `not1`, producing `not1_out`, then into a gate labeled `and1`
- middle branch: `b` goes through an inverter labeled `not2`, producing `not2_out`, then into a gate labeled `and2`
- outputs of `and1` and `and2` feed an `or1` gate; output labeled `sum`
- bottom branch goes to `and3`; output labeled `carry`
- an arrow point

[Truncated for analysis]

### Key points

- A Verilog module represents a hardware block with ports and internal logic.
- Modules are written using `module ... endmodule`.
- `wire` declarations represent physical signal connections and do not store information.
- Verilog has built-in gate primitives including `and`, `or`, `not`, `xor`, and their complements.
- Gate instantiation syntax places the output first, followed by the inputs.
- A half-adder can be built structurally from explicit primitive gates and intermediate wires.

### Related topics

- [[verilog-as-a-hardware-description-language|Verilog as a Hardware Description Language]]
- [[behavioral-modeling-and-continuous-assignment|Behavioral Modeling and Continuous Assignment]]
- [[fpga-lut-mapping-and-asic-standard-cell-mapping|FPGA LUT Mapping and ASIC Standard-Cell Mapping]]

### Relationships

- contrasts-with: [[behavioral-modeling-and-continuous-assignment|Behavioral Modeling and Continuous Assignment]]
