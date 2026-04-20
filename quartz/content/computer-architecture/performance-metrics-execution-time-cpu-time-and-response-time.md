---
title: "Performance Metrics: Execution Time, CPU Time, and Response Time"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 7", "Page 8"]
related: ["cpu-time-clocking-and-the-basic-performance-equation", "instruction-count-cpi-and-the-full-cpu-performance-equation", "seven-great-ideas-in-computer-architecture"]
tags: ["performance", "execution-time", "cpu-time", "response-time", "elapsed-time", "performance-ratio", "i-o"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-007.png", "/computer-architecture/assets/computer-architecture-2-page-008.png"]
---

## Performance Metrics: Execution Time, CPU Time, and Response Time

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 7, Page 8

The notes define performance as fundamentally a time-based concept: a computer is better performing when it completes a task in less time. Performance is therefore treated as the inverse of execution time. Execution time is the total time required for the hardware to complete a given program, including CPU execution, memory access, I/O activity initiated by the program, and operating system overhead associated with that program. CPU time is narrower: it is the portion of execution time during which the processor is actively computing instructions for the program, excluding waiting for I/O and delays due to unrelated scheduling. Response time, also called elapsed time, is broader than execution time because it includes waiting caused by other programs, idle time, and scheduling delays. The notes use a CPU timeline for program P1 to distinguish these concepts numerically: response time is 6, CPU time is 3, and execution time is 4 because it includes waiting for I/O. A second worked example compares two computers by performance ratio: if A runs a program in 10 seconds and B in 15 seconds, A is 1.5 times as fast as B.

### Source snapshots

![Computer Architecture-2 Page 7](/computer-architecture/assets/computer-architecture-2-page-007.png)

![Computer Architecture-2 Page 8](/computer-architecture/assets/computer-architecture-2-page-008.png)

### Page-grounded details

#### Page 7

- Now we can illustrate the five classic components which are input, output
memory, datapath, and control, with the last two combined and called
the processor

[Diagram]
- Small labeled sketch above the main box:
  - `compiler`
  - `interface`
- Main boxed diagram labeled `computer`
  - Inside left section:
    - `control`
    - `Datapath`
  - Bottom labels:
    - `processor` (under the left section containing control + datapath)
    - `Memory` (under the right section)
  - Right side labels:
    - `Input`
    - `out put`
- Separate sketch on left:
  - Magnifying glass labeled:
    - `Evaluating`
    - `Performance`

√ The processor gets instructions and data from memory. Input writes data to
memory, and output reads data from memory. Control sends the signals
that determine the operations of the datapath, memory, input and output.

->

=> Computer Performance

- Performance is a measure of how fast a computer system completes a
task. In computer architecture the only measure of performance is time,
specifically how long a program takes to run

√ Execution time : is the total time required for the computer hardware
to complete a given program. It includes the time spent by the CPU

[Truncated for analysis]

#### Page 8

- Performance is defined as the inverse of execution time, since
performance improves when execution time decreases.

  Performance = 1
        Execution Time

\ ex/ If computer A runs a program in 10 Seconds and computer B
runs the same program in 15 seconds, how much faster is A than B?

\ Solution:  A is n times as fast as B if

  PerformanceA   =   Execution TimeB   = n
  PerformanceB       Execution TimeA

- ∴ the performance ratio is 15/10 = 1.5 and A is
 1.5 times as fast as B

- CPU Time is the portion of execution time during which the processor
is actively executing instructions for the program. It excludes time
spent waiting for I/O operations, memory accesses outside the CPU pipeline
or delays caused by operating system, scheduling other programs.

 - CPU time = time the processor is used for computing

- Response Time: Execution time, in turn, is always part of a broader
measure called response time. (Also known as elapsed time), Response time
is the total time observed by the user from the start of a task
until its completion. In addition to execution time, it includes time
spent waiting while other programs are running, idle time, and delays
introduced by system sche

[Truncated for analysis]

### Key points

- Performance is defined as the inverse of execution time.
- Execution time includes CPU work, memory access, program I/O, and program-related OS overhead.
- CPU time includes only time when the processor is actively computing for the program.
- Response time includes execution time plus waiting from scheduling, contention, and idle delays.
- Execution time is a property of the program and the machine it runs on.
- Performance comparison uses ratios of execution times or inverse times.

### Related topics

- [[cpu-time-clocking-and-the-basic-performance-equation|CPU Time, Clocking, and the Basic Performance Equation]]
- [[instruction-count-cpi-and-the-full-cpu-performance-equation|Instruction Count, CPI, and the Full CPU Performance Equation]]
- [[seven-great-ideas-in-computer-architecture|Seven Great Ideas in Computer Architecture]]

### Relationships

- depends-on: [[cpu-time-clocking-and-the-basic-performance-equation|CPU Time, Clocking, and the Basic Performance Equation]]
- depends-on: [[instruction-count-cpi-and-the-full-cpu-performance-equation|Instruction Count, CPI, and the Full CPU Performance Equation]]
