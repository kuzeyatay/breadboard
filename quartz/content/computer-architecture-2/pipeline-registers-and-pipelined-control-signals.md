---
title: "Pipeline registers and pipelined control signals"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 108"]
related: ["single-cycle-multicycle-and-pipelined-execution", "hazards-in-pipelined-processors", "datapath-and-control-partition-in-processor-design"]
tags: ["pipeline-registers", "if-id", "id-ex", "ex-mem", "mem-wb", "control", "pipeline"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-108-2.png"]
---

## Pipeline registers and pipelined control signals

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 108

Once instructions overlap in a pipeline, the processor must preserve intermediate values produced at the end of each stage so later stages can continue working on the correct instruction during the next cycle. The notes identify four pipeline registers: `IF/ID`, `ID/Ex`, `Ex/MEM`, and `MEM/WB`, placed between the five classic pipeline stages. Each register must hold both data and relevant control information. The notes specify minimum contents: `IF/ID` holds the current PC and current instruction; `ID/Ex` holds the PC, two register-read values, and immediate data; `EX/MEM` holds the ALU output, branch-related address or decision information, and `Read Register 2`; and `MEM/WB` holds memory-read data and the ALU output. Importantly, control values must also be pipelined. Signals generated during decode cannot simply stay local to that cycle; they must travel forward with the instruction so that later stages know whether to write memory, select a mux input, or write a register.

### Source snapshots

![Computer Architecture-2 Page 108](/computer-architecture/assets/computer-architecture-2-page-108-2.png)

### Page-grounded details

#### Page 108

√ But to pipeline a processor, you must pay a price in hardware
If several instructions are in flight at once, the processor must
remember the intermediate results produced by each stage so that
the next stage can use them in the following cycle, while the earlier
stage begins working on a different instruction. That is the role
of the pipeline registers

[Diagram]
- A horizontal datapath diagram with blocks and pipeline registers between stages.
- Curved arrows from the sentence "pipeline registers" point downward to the vertical register blocks.
- Left to right labels and blocks:
  - "instruction memory" above the first block
  - `I.M` inside a box
  - `(IF)` below that box
  - vertical pipeline register labeled `IF/ID`
  - `Reg` inside a box
  - `(ID)` below that box
  - vertical pipeline register labeled `ID/Ex`
  - `ALU` inside a right-pointing wedge/arrow-shaped block
  - `(Ex)` below that block
  - vertical pipeline register labeled `Ex/MEM`
  - `D.M` inside a box
  - `(Mem)` below that box
  - vertical pipeline register labeled `MEM/WB`
  - `Reg` inside a box
  - `(WB)` below that box
- All blocks are connected by a single horizontal line through the diagram.

√ The content

[Truncated for analysis]

### Key points

- Pipeline registers separate the IF, ID, EX, MEM, and WB stages.
- The pipeline registers are `IF/ID`, `ID/Ex`, `Ex/MEM`, and `MEM/WB`.
- `IF/ID` stores at least the current PC and current instruction.
- `ID/Ex` stores at least PC, `Read Register 1`, `Read Register 2`, and immediate data.
- `EX/MEM` stores at least ALU output, branch-related information, and `Read Register 2`.
- `MEM/WB` stores at least data read from memory and ALU output.
- Pipeline registers preserve intermediate results while earlier stages begin later instructions.
- Control signals must be carried forward through the pipeline along with data.

### Related topics

- [[single-cycle-multicycle-and-pipelined-execution|Single-cycle, multicycle, and pipelined execution]]
- [[hazards-in-pipelined-processors|Hazards in pipelined processors]]
- [[datapath-and-control-partition-in-processor-design|Datapath and control partition in processor design]]

### Relationships

- depends-on: [[hazards-in-pipelined-processors|Hazards in pipelined processors]]
