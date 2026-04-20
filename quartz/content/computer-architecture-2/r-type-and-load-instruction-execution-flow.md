---
title: "R-type and load instruction execution flow"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 98", "Page 99", "Page 100"]
related: ["immediate-generation-and-sign-extension-in-risc-v", "data-memory-interface-and-address-calculation", "datapath-and-control-partition-in-processor-design", "main-control-and-alu-control-truth-tables"]
tags: ["r-type", "alusrc", "memtoreg", "regwrite", "aluop", "pc-4"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-098-2.png", "/computer-architecture/assets/computer-architecture-2-page-099-2.png"]
---

## R-type and load instruction execution flow

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 98, Page 99, Page 100

The execution sequence section traces how instructions move through the single-cycle datapath. For an R-type example `add x22, x20, x21`, the PC supplies the instruction address to instruction memory while a separate adder computes `PC + 4` in parallel. The instruction is decoded so that `rs1 = x20`, `rs2 = x21`, and `rd = x22`. Since R-type add has no immediate, `ImmGen` is unused, `ALUsrc` selects the second register value, `ALUOp` directs the ALU to add, and `MemtoReg` selects the ALU result for write-back. `RegWrite` is enabled, and the PC finally takes the sequential `PC + 4`. The load example `lw x9, 32(x22)` differs mainly in address generation and memory usage: `ImmGen` sign-extends the 12-bit immediate, `ALUsrc` selects that immediate, the ALU computes the effective address, data memory performs a read with `MemRead = 1`, and `MemtoReg` selects memory output so the loaded word can be written into `x9`.

### Source snapshots

![Computer Architecture-2 Page 98](/computer-architecture/assets/computer-architecture-2-page-098-2.png)

![Computer Architecture-2 Page 99](/computer-architecture/assets/computer-architecture-2-page-099-2.png)

### Page-grounded details

#### Page 98

down The processor execution order:

1. PC supplies the address of the current instruction (32 bits).

2. Instruction Memory returns the 32-bit actual instruction at that address

3. Instruction is decoded and split

4. The register file reads the source registers named in instruction.

5. The datapath performs the instruction-specific work

6. A result is written back to a register or to memory if needed

7. The PC is updated for the next instruction

Case 1: R-Type arithmetic instruction (Check slides here)
down ex/ add x22, x20, x21

funct7      rs2      rs1      funct3      rd      opcode
0000000     10101    10100    000         10110   011011
[31-25]     [24-20]  [19-15]  [14-12]     [11-7]  [6-0]

down The PC contains the address of the current add instruction, that PC value is sent to the instruction memory, so the instruction can be fetc[unclear]
and at the same time it is also sent to the separate PC+4 adder, so the
next instruction can be prepared in parallel.

down Instruction memory reads the instruction stored at the address [unclear]
outputs the 32-bit encoding of "add x22, x20, x21"

down The instruction is then decoded, From the instruction fields, the processo[unc

[Truncated for analysis]

#### Page 99

down The register file recieves those selector fields

down For this instruction, ImmGen is not used, because an R-type add has
  no immediate operand.

down The ALU-source mux must choose the second register value, not an
  immediate. So ALUsrc selects read data 2. So now the ALU recieves first
  input: contents of x20. second input: contents of x21 and ALUop tells the
  ALU to perform addition, so it computes x20 + x21 which is the value
  that appears on the ALU result output.

down Data Memory is unused in this case since no load or store is happening,
  MemtoReg (Mux) selects the ALU path.

down Now the register file recieves the write data input, which is the ALU
  result and control sets regwrite = 1. therefore the processor writes
  the ALU result into x22

down Meanwhile, the separate PC+4 adder has already computed the sequential
  address PC+4. Since this is not a branch or jump, the PC-selection mux
  chooses the normal sequential value PC+4 so PC becomes PC+4 and
  then, in the next clock cycle, next instruction is executed.

down Case 2: Load Instruction

ex/ lw x9, 32(x22)

[diagram of instruction-format boxes:]
immediate (adress offset) | rs1 | funct3 | rd | opcode

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

### Key points

- Instruction execution begins with PC-based fetch and parallel computation of `PC + 4`.
- An R-type `add` decodes `rs1`, `rs2`, and `rd` directly from the instruction fields.
- For R-type add, `ImmGen` is unused.
- For R-type add, `ALUsrc` selects register operand 2 and the ALU performs addition.
- For R-type add, data memory is unused and `MemtoReg` selects the ALU result.
- A load instruction uses `ImmGen` to sign-extend the 12-bit immediate.
- For load, `ALUsrc` selects the immediate so the ALU computes base-plus-offset.
- For load, `MemRead = 1`, `MemWrite = 0`, and the write-back mux selects memory data.

### Related topics

- [[immediate-generation-and-sign-extension-in-risc-v|Immediate generation and sign extension in RISC-V]]
- [[data-memory-interface-and-address-calculation|Data memory interface and address calculation]]
- [[datapath-and-control-partition-in-processor-design|Datapath and control partition in processor design]]
- [[main-control-and-alu-control-truth-tables|Main control and ALU control truth tables]]

### Relationships

- depends-on: [[main-control-and-alu-control-truth-tables|Main control and ALU control truth tables]]
