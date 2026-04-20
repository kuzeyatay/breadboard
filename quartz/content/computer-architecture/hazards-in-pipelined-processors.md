---
title: "Hazards in pipelined processors"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 109", "Page 110", "Page 111", "Page 112"]
related: ["single-cycle-multicycle-and-pipelined-execution", "pipeline-registers-and-pipelined-control-signals", "program-counter-and-instruction-memory", "data-memory-interface-and-address-calculation"]
tags: ["hazards", "structural-hazard", "data-hazard", "control-hazard", "forwarding", "branch-prediction", "hazard-detection"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-109-2.png", "/computer-architecture/assets/computer-architecture-2-page-110-2.png"]
---

## Hazards in pipelined processors

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 109, Page 110, Page 111, Page 112

The notes define a hazard as any situation that prevents the next instruction from moving through the pipeline according to the ideal timing diagram. Three types are identified: structural, data, and control hazards. A structural hazard is a hardware-resource conflict, such as instruction fetch and memory access competing for a single unified memory; the standard solution given is to separate instruction memory and data memory. A data hazard occurs when a later instruction needs a value that an earlier instruction has not yet made available. The example `add s0, t0, t1` followed by `sub t2, s0, t3` shows how the second instruction may see the old value of `s0` if it reads too early. Remedies include forwarding, where results are bypassed directly from internal pipeline stages to later ALU inputs, and hazard detection, which inserts bubbles when a needed value does not yet exist, especially for load-use hazards. The notes also mention compiler scheduling as a software method to reduce unavoidable stalls. Control hazards arise when the fetch stage does not yet know the correct next PC during branches; solutions include stalling, static prediction such as predict-not-taken or backward-taken/forward-not-taken, and dynamic prediction using remembered branch history.

### Source snapshots

![Computer Architecture-2 Page 109](/computer-architecture/assets/computer-architecture-2-page-109-2.png)

![Computer Architecture-2 Page 110](/computer-architecture/assets/computer-architecture-2-page-110-2.png)

### Page-grounded details

#### Page 109

[Su] [Mo] [To] [Wo] [Th] [Fr] [So]

No.
Date    /    /

5) Hazards: the Reality

 deg The moment several instructions overlap in time, they begin to
interfere with one another. A hazard is any situation that prevents
the next instruction from moving through the pipeline exactly as
the ideal timing diagram would suggest. The three fundamental
types are:

 deg Structural Hazards

 deg Data Hazards

 deg Control Hazards

Each corresponding to a different kind of conflict and each demands
a different remedy

1) Structural Hazard: Is a conflict over hardware resources.
Two stages of two different instructions want the same physical
resource at the same time. The standard example is memory. If
the processor had only one unified memory, then a lw or a sw
in the MBU stage would compete with instruction fetch
in the IF stage, creating a bubble (Pipeline stall). The
standard RISC-V solution is therefore to separate memory
into two : Data memory and instruction memory.

2) Data Hazard :- Occurs when a later instruction needs a
value that an earlier instruction has not yet made
available in the place where the later instruction is
expected to find it

down ex/
add s0, t0, t1
Sub t2, s0, t3

do

[Truncated for analysis]

#### Page 110

[Top printed page elements]
Su  Mo  Tu  We  Th  Fr  Sa

No. __________
Date      /   /

....................................................................................................

time

200    400    600    800    1000    1200    1400    1600   ->

add s0, t0, t1    [IFx] - [IDx] - [Ex] - [MEM] - [WB]

[Several cloud-shaped bubbles drawn beneath and between stages, indicating stalls/empty slots.]

[A second pipeline row is drawn lower on the page:]
[IFx] - [IDx] - [Ix] - [MEM] - [WB]

[A vertical double-headed arrow is drawn between the upper `WB` area and the lower `IDx` area.]

√ In this schema, the bubbles mark stall cycles: empty pipeline
slots inserted because the sub instruction cannot safely use
s0 until the earlier add has produced and stored that value

√ One important subtley is that some apparent hazards disappear
because of how the register file itself is timed. A common
implementation assumption is that register write occurs in the first
half of the cycle and register read in the second half. (register
read and writes are so fast that they can be arranged within the
same cycle, while the ALU and memory operations generally consume
the full cycle)

√ The large

[Truncated for analysis]

#### Page 111

Su  Mo  Tu  We  Th  Fr  Sa

No. ____________
Date      /    /

instructions   time

200      400      600      800      1000

add  s0, t0, t1

[Diagram: pipeline stages drawn left to right with labels inside boxes:
`IF` -> `ID` -> `EX` -> `MEM` -> `WB`.
A forwarding path is drawn from the output around `EX` of the first instruction downward into the next instruction's path.]

Sub  t2, s0, t3

[Diagram: second pipeline row with stages:
`IF` -> `ID` -> `EX` -> `MEM` -> `WB`.
A dot/node appears near the input to `EX`, connected upward to the forwarding path from the first instruction.]

down This is literally a new wire path , a sort of parallel data
wires , together with control that opens this path only when a
hazard is detected

down Yet forwarding does not solve every data hazard . An example
is the load use hazard . A load produces its final value only after
memory access . If the very next instruction needs that loaded value
too early , then the processor cannot simply "forward it sooner" because
the value literally doesn't exist sooner . This is why a pipelined processor
needs a hazard detection unit working in conjunction with the forwarding
unit . The forwarding unit removes

[Truncated for analysis]

#### Page 112

3) Control Hazards

* Control hazards arise for a different reason. When the pipeline
reaches a conditional branch, it does not yet know with certainty
where the next instruction should come from. Should the fetch
stage (1 stage) continue with the next instruction, or should it jump
to the branch target? That depends on a condition that is resolved only
later. So the very act of fetching the next instruction becomes
uncertain

down The simplest solution is to stall on every branch until the processor
knows the outcome, however that costs performance.

down A better idea is branch prediction:

a) Static branch Prediction: means that the processor uses a fixed
rule. The simplest static rule is predict not taken: That means,
after fetching a branch instruction, keep going with the next sequential
instruction as if the branch will fall through (be false). If that guess
is right, the pipeline loses no time, if its wrong, then the
instruction, [then the] instruction or instructions fetched along
the wrong path must be thrown away, and fetching restarts at the
correct stage, but loosing time in the meanwhile.

down A slightly smarter static rule is: Predict backward
branches taken, forwar

[Truncated for analysis]

### Key points

- A hazard is any condition that prevents ideal pipeline progression.
- The three hazard classes are structural, data, and control hazards.
- A structural hazard is a hardware resource conflict, such as unified memory contention.
- Separating instruction memory and data memory avoids the standard structural memory conflict.
- A data hazard occurs when a later instruction needs a value not yet available.
- Forwarding bypasses results from internal stages directly to later ALU inputs.
- Load-use hazards may still require stalls because the loaded value does not exist early enough.
- A hazard detection unit inserts bubbles when waiting is necessary.
- Compilers can reduce stalls by rescheduling instructions.
- Control hazards arise from uncertainty about branch direction and target during fetch.
- Static and dynamic branch prediction are remedies for control hazards.

### Related topics

- [[single-cycle-multicycle-and-pipelined-execution|Single-cycle, multicycle, and pipelined execution]]
- [[pipeline-registers-and-pipelined-control-signals|Pipeline registers and pipelined control signals]]
- [[program-counter-and-instruction-memory|Program counter and instruction memory]]
- [[data-memory-interface-and-address-calculation|Data memory interface and address calculation]]

### Relationships

- depends-on: [[program-counter-and-instruction-memory|Program counter and instruction memory]]
- depends-on: [[data-memory-interface-and-address-calculation|Data memory interface and address calculation]]
