---
title: "Single-cycle, multicycle, and pipelined execution"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 105", "Page 106", "Page 107"]
related: ["pipeline-registers-and-pipelined-control-signals", "hazards-in-pipelined-processors", "datapath-and-control-partition-in-processor-design"]
tags: ["single-cycle", "multi-cycle", "pipelining"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-105-2.png", "/computer-architecture/assets/computer-architecture-2-page-106-2.png"]
---

## Single-cycle, multicycle, and pipelined execution

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 105, Page 106, Page 107

The performance section compares three execution styles. In the single-cycle processor, each instruction conceptually passes through the phases IF, ID, EX, MEM, and WB, but all of that work must fit inside one clock period long enough for the worst-case instruction, typically one involving data-memory access. This wastes time for shorter instructions such as arithmetic and branch operations, which do not need all five phases. The multicycle processor improves this by assigning work to separate cycles, allowing shorter instructions to finish in fewer cycles and setting the clock period by the slowest individual stage instead of the entire instruction path. However, multicycle execution still underuses hardware because only one stage may be active for one instruction at a time. Pipelining improves throughput by overlapping stages from different instructions, so while one instruction is in EX, another can be in ID and another in IF. The timing example contrasts a non-overlapped 800 ps single-cycle instruction path with a pipelined design using 200 ps stages and notes a `5x throughput Speedup`.

### Source snapshots

![Computer Architecture-2 Page 105](/computer-architecture/assets/computer-architecture-2-page-105-2.png)

![Computer Architecture-2 Page 106](/computer-architecture/assets/computer-architecture-2-page-106-2.png)

### Page-grounded details

#### Page 105

=> Performance (Look at the images in slides.)

- Although the single-cycle processor completes each instruction in
one clock cycle, its still usefull to think of the information flow in
phases:

IF (instruction fetch) -> ID (instruction Decode/
(Register file read)) -> Ex (Execute/
Address calculation) -> Mem -> WB
down                     down
memory                write
access                back

[Diagram: a long horizontal bracket/line labeled `Single Cycle processor`, spanning from `instruction starts` on the left to `instruction ends.` on the right.]

√ This conceptual decomposition foreshadows why the single cycle machine
is easy to understand but inefficient. Different instructions do different
amounts of work. For example an arithmetic instruction has no need to
access memory, a branch does not write a result register, same as a load
does etc. Yet the single-cycle design forces all instructions to fit within
one universal clock period long enough for the worst case instruction to
finish. (usually access to data memory is the critical path). Remember the
performance metric:

CPU clock cycles = Instruction Count for program x Average clock cycles
per Instruction

down Meani

[Truncated for analysis]

#### Page 106

However, we can improve perfomance with a MultiCycle Processor

=> Multi Cycle Processor (and why it still is not enough)

- The next obvious step is to stop forcing every instruction to do
all its work inside one giant cycle. In a multicycle processor, the
work is split into multiple clock cycles, usually one stage per cycle

[Diagram]
- A long horizontal timing line with two labeled spans:
  - `Cycle-1` shown with a double-headed horizontal arrow.
  - `Cycle-2` shown with a double-headed horizontal arrow.
- To the right, a vertical bracket labels the upper timing as `Single cycle`.
- Beneath it, a large box-like partition labeled:
  - `Load`
  - `Store`
  - `Waste`
- Below that, a repeated clock waveform labeled by cycle:
  - `cycle 1`, `cycle 2`, `cycle 3`, `cycle 4`, `cycle 5`, `cycle 6`, `cycle 7`, `cycle 8`, `cycle 9`, `cycle 10`
- To the right, a vertical bracket labels this lower timing as `Multi Cycle`.
- Bottom row shows stage boxes for two instructions:
  - Under `Load`: `Ifetch | Reg | Exec | Mem | Wr`
  - Under `Store`: `Ifetch | Reg | Exec | Mem | Wr`

down Fetch takes a cycle, decode/register takes a cycle, execute takes
a cycle etc. The clock period is now determine

[Truncated for analysis]

#### Page 107

down However, Multi-Cycle execution still leaves another waste
untouched. At any given cycle, only one part of the hardware
may be doing useful Work. During fetch, instruction memory
is busy while the ALU, data memory and write back hardware
are empty. There is still unused hardware and unused hardware
means lost throughput thats why we have pipelining.

=> Pipelining : the real processor data
- The pipelining idea is to overlap the steps of different instructions
As soon as instruction 1 leaves the fetch (first) stage,
instruction 2 can enter fetch while instruction 1 proceeds
to the decode (second) stage.

Program execution         time ->
order (in instructions)        200   400   600   800   1000   1200   1400   1600   1800
- Single-cycle (T₍c₎ = 800ps).

lw x1, 100(x4)

[diagram: one rectangular pipeline block divided into 5 stages labeled, left to right:
"Inst fetch" | "Reg" | "ALU" | "Data access" | "Reg";
a double-headed horizontal arrow beneath the full block labeled "800ps"]

lw x2, 200(x4)

[diagram: a second 5-stage block shifted right in time, labeled left to right:
"Instruction fetch" | "Reg" | "ALU" | "Data access" | "Reg";
a double-headed horizontal arrow beneath th

[Truncated for analysis]

### Key points

- Single-cycle execution conceptually contains IF, ID, EX, MEM, and WB within one cycle.
- The single-cycle clock period must be long enough for the worst-case instruction.
- Shorter instructions waste time in a single-cycle design because they do not need every phase.
- The multicycle design splits work across several cycles, often one stage per cycle.
- In a multicycle processor, the clock period is set by the heaviest stage rather than the full instruction path.
- Pipelining overlaps different instructions across stages to improve throughput.
- The notes compare single-cycle timing with 800 ps and pipelined stage timing with 200 ps.
- The pipelined example claims a 5x throughput speedup.

### Related topics

- [[pipeline-registers-and-pipelined-control-signals|Pipeline registers and pipelined control signals]]
- [[hazards-in-pipelined-processors|Hazards in pipelined processors]]
- [[datapath-and-control-partition-in-processor-design|Datapath and control partition in processor design]]

### Relationships

- depends-on: [[pipeline-registers-and-pipelined-control-signals|Pipeline registers and pipelined control signals]]
- related: [[hazards-in-pipelined-processors|Hazards in pipelined processors]]
