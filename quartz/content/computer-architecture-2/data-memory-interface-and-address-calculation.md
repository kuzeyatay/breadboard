---
title: "Data memory interface and address calculation"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 93", "Page 100", "Page 101"]
related: ["immediate-generation-and-sign-extension-in-risc-v", "r-type-and-load-instruction-execution-flow", "store-instruction-execution-flow", "datapath-and-control-partition-in-processor-design"]
tags: ["data-memory", "memread", "memwrite", "address", "write-data", "read-data"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-093-2.png", "/computer-architecture/assets/computer-architecture-2-page-100-2.png"]
---

## Data memory interface and address calculation

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 93, Page 100, Page 101

The data memory block stores and retrieves program data such as arrays, variables, stack contents, and saved values during execution. It is distinct from the register file in both size and access mode: it is much larger, addressed with full 32-bit memory addresses, and organized in 8-bit cells. The interface shown in the notes includes an address input, write-data input, read-data output, and the control signals `MemRead` and `MemWrite`. For load/store instructions, the ALU usually produces the address by adding a base register and a sign-extended immediate offset. The worked example `sw x9, 32(x22)` shows the complete path: `x22` supplies the base address, `x9` supplies the value to store, `ImmGen` sign-extends `32`, and the ALU computes `x22 + 32`, after which control enables memory writing. The memory map diagram further distinguishes data memory from instruction memory and places stack, heap, static data, and code in separate regions.

### Source snapshots

![Computer Architecture-2 Page 93](/computer-architecture/assets/computer-architecture-2-page-093-2.png)

![Computer Architecture-2 Page 100](/computer-architecture/assets/computer-architecture-2-page-100-2.png)

### Page-grounded details

#### Page 93

-> Data Memory : is the memory block used to store and retrieve
data values during program execution such as arrays, variables,
stack content, and saved values. It is much larger than the register
file and is accessed through a full 32 bit memory address (usually in hex
format). It is mainly used by load and store instructions. Each "cell" is also
8 bits // byte
wide, contrary to
the register file.
(32 bit wide)

[Diagram: left block diagram of memory interface]
- A rectangular memory block.
- Top incoming arrow from above labeled `MemWrite`.
- Near the top inside the block: `write?`
- Left middle incoming arrow labeled `Address`
- Left lower incoming arrow labeled `Write
Data`
- Right outgoing arrow labeled `Read
data`
- Bottom incoming arrow from below labeled `MemRead`
- Near the bottom inside the block: `read?`

[Diagram: right memory layout]
- Left of the diagram near the top: `0x7FFFFFFC`
- A tall vertical memory map rectangle.
- Top section labeled `Stack`
- Inside upper area: one downward arrow and one upward arrow
- Middle section labeled `Dynamic Data (Heap)`
- Below it: `Static Data`
- Below that: `Instructions
(your code)`
- Bottom section: `Reserved`
- Left of the diag

[Truncated for analysis]

#### Page 100

down When the instruction is decoded, the processor identifies:

- rs1 = x22  (=> Read Register 1)

- rd = x9  (=> Write Register)

down The Im Gen takes the 12 bit immediate (32) field from the instruction
and sign extends it to 32 bits, so ImmGen outputs a 32-bit representation
of 32

down For a load instruction, the ALU-source mux must choose the immediate, not the
second register output. So ALUsrc selects the ImGen output

down Therefore the ALU receives : first input : contents of x22 (base address)
(0x000010000)  second input : sign extended immediate 32 (0x00000020).
The ALU is set to ADD, so it computes the effective address x22 + 32 (
0x00001000 + 0x00000020 = 0x00001020) (x22 is being used to store the starting
memory address, and the ALU takes that stored value and adds the offset to it)

down That ALU result is sent to the address input of Data Memory and since
this is a load, controls are MemRead = 1 and MemWrite = 0 so data
memory reads the word stored at address x22 + 32 and outputs it on its
Read data line.

down The MemtoReg mux (write-back mux) must now choose the memory read
data (not the ALU result)

down Then the register file receives write data = memory read

[Truncated for analysis]

#### Page 101

Case 3  Store Instruction

down ex/ sw x9, 4(x22)

[Diagram: S-type instruction format drawn as a horizontal bit-field box:
`imm[11:5] | rs2 | rs1 | funct3 | imm[4:0] | opcode`
with bit labels underneath:
`[31-25]   [24-20] [19-15] [14-12] [11-7] [6-0]`]

down The PC provides the current instruction address to instruction memory, and
also feeds the PC+4 adder

down Instruction memory outputs the 32 bit encoding of sw x9, 4(x22)

down The instruction is decoded as a store with fields

- rs1 = x22  (=> Read data1, base address)

- rs2 = x9  (=> Read data2, value to store)

down The immgen reconstructs the S-type immediate from its split instruction
fields and sign extends it to 32 bits

down The ALU source mux (ALUsrc) again chooses the immediate, thus the ALU
receives first input, base address from x22  second input- sign extended
immediate 4, and it performs addition (specified by ALU op) and computes
the effective address x22+4

down Result goes to the address input of data memory and Read data 2
from the register file, which is the contents of x9, goes directly to
the write data input of Data Memory, and since this is a store, the
controls are MemWrite=1 and MemRead =0 so data me

[Truncated for analysis]

### Key points

- Data memory stores runtime data such as arrays, variables, stack content, and saved values.
- It is larger than the register file and is accessed with a 32-bit memory address.
- Each memory cell is 8 bits wide.
- Key interface signals are `Address`, `Write Data`, `Read data`, `MemRead`, and `MemWrite`.
- The address input usually comes from the ALU result.
- The write-data input usually comes from the second register-file read output.
- Load and store instructions are the primary users of data memory.
- The example `sw x9, 32(x22)` computes effective address `x22 + 32` before writing.

### Related topics

- [[immediate-generation-and-sign-extension-in-risc-v|Immediate generation and sign extension in RISC-V]]
- [[r-type-and-load-instruction-execution-flow|R-type and load instruction execution flow]]
- [[store-instruction-execution-flow|Store instruction execution flow]]
- [[datapath-and-control-partition-in-processor-design|Datapath and control partition in processor design]]

### Relationships

- applies-to: [[r-type-and-load-instruction-execution-flow|R-type and load instruction execution flow]]
- applies-to: [[store-instruction-execution-flow|Store instruction execution flow]]
