---
title: "CPU Time, Clocking, and the Basic Performance Equation"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 20", "Page 22"]
related: ["performance-metrics-execution-time-cpu-time-and-response-time", "combinational-and-sequential-logic-in-processors", "instruction-count-cpi-and-the-full-cpu-performance-equation"]
tags: ["cpu-time", "clock", "clock-cycle", "clock-rate", "clock-period", "performance-equation"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-020.png", "/computer-architecture/assets/computer-architecture-2-page-022.png"]
---

## CPU Time, Clocking, and the Basic Performance Equation

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 20, Page 22

The notes next connect performance measurement to processor timing. A processor is described as a synchronous digital system coordinated by a periodic clock signal. The clock alternates between 0 and 1 voltage levels; the notes associate the rising edge with updating stored data, while between edges computation prepares the next values. One complete oscillation is a clock cycle, and clock frequency measures how many cycles occur per second. For example, a 2 GHz processor completes 2 billion cycles per second, so each clock cycle lasts 0.5 nanoseconds. This reciprocal relationship links clock rate and clock period. The notes then derive the basic CPU performance equation: `CPU execution time for a program = CPU clock cycles for a program x clock cycle time`, equivalently `CPU time = CPU clock cycles / clock rate`. Designers can improve performance by reducing the number of cycles needed or increasing the clock rate, but these are not independent because techniques that reduce cycle count may increase cycle time. A worked example uses this formula to derive that a target processor B must run at 4 GHz to complete a job in 6 seconds when its cycle count is 1.2 times that of a 2 GHz processor A taking 10 seconds.

### Source snapshots

![Computer Architecture-2 Page 20](/computer-architecture/assets/computer-architecture-2-page-020.png)

![Computer Architecture-2 Page 22](/computer-architecture/assets/computer-architecture-2-page-022.png)

### Page-grounded details

#### Page 20

Week 2 - Lecture 1

=> CPU Performance and its factors:
CPU time; is a widely used performance metric. It is defined as the duration
where the processor is actively executing instructions for a particular
problem, it doesn't include time spent waiting for unrelated programs, and
it seperates processor activity from external delays. To understand
CPU time properly, we must understand how time is represented
inside a processor.

- A processor is a synchronous digital system This means that
changes in the processor's internal state occur in coordination
with a periodic timing signal called the clock

[Diagram]
- Label at top with a double-headed horizontal arrow: clock Period
- Left vertical axis label: Clock(cycles)
- Square-wave clock drawn across the page
- Two edge labels under the waveform:
  - 1 -> 0
    falling edge
  - 0 -> 1
    rising edge
- Row label beneath clock: Data transfer
  and computation
- Two long horizontal capsule-like regions across consecutive clock periods in this row
- Row label beneath that: update state
- Two small polygon/hexagon-like markers aligned with vertical dashed lines in this row
- Horizontal axis ends with arrow at right labeled: t
- Vertical da

[Truncated for analysis]

#### Page 22

-> Since the processor updates its state only at clock edges
the execution of a program can be viewed as a sequence of
clock cycles. If a program requires a certain number of clock
cycles to complete, and each cycle lasts a certain amount of time,
Then the total CPU time is simply:

CPU execution
time for a
program   ≡   CPU clock cycles
for a program   x   clock cycle time

Alternatively, because clock cycle and clock rate are time inverse,

CPU time = CPU clock cycles
           ----------------
             clock rate

down This formula makes it clear that the hardware designer
can improve performance by:

▸ Reducing number of clock cycles per program

▸ Increase clock rate

▸ Design a processor that uses less clock cycles per program

▿ The designer often faces a trade-off between the number of clock
cycles needed for a program and the length of each cycle because
many techniques that decrease the number of clock cycles may
also increase the clock cycle time,

p can be an exam question.

✓ ex/ let computer A have a 2GHz clock rate and 10s CPU
time for a job If computer B aims to do the same job in 6s
with a clock cycle 1.2 times than of A, what clock
rate must computer B have?

[Truncated for analysis]

### Key points

- Processors are synchronous systems controlled by a periodic clock.
- A clock cycle is one complete oscillation of the clock signal.
- Clock frequency and clock period are reciprocals.
- A 2 GHz clock corresponds to 2 billion cycles per second and a 0.5 ns period.
- CPU time equals clock cycles multiplied by clock cycle time.
- Equivalent form: `CPU time = CPU clock cycles / clock rate`.
- Reducing cycle count and increasing clock rate can both improve performance, but often trade off.

### Related topics

- [[performance-metrics-execution-time-cpu-time-and-response-time|Performance Metrics: Execution Time, CPU Time, and Response Time]]
- [[combinational-and-sequential-logic-in-processors|Combinational and Sequential Logic in Processors]]
- [[instruction-count-cpi-and-the-full-cpu-performance-equation|Instruction Count, CPI, and the Full CPU Performance Equation]]

### Relationships

- depends-on: [[combinational-and-sequential-logic-in-processors|Combinational and Sequential Logic in Processors]]
- depends-on: [[instruction-count-cpi-and-the-full-cpu-performance-equation|Instruction Count, CPI, and the Full CPU Performance Equation]]
