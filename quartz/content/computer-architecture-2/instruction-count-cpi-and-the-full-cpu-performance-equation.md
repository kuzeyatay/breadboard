---
title: "Instruction Count, CPI, and the Full CPU Performance Equation"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 23", "Page 24"]
related: ["cpu-time-clocking-and-the-basic-performance-equation", "performance-metrics-execution-time-cpu-time-and-response-time", "from-high-level-code-to-assembly-and-machine-language"]
tags: ["instruction-count", "cpi", "cpu-time", "clock-period", "clock-rate", "compiler", "isa"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-023.png", "/computer-architecture/assets/computer-architecture-2-page-024.png"]
---

## Instruction Count, CPI, and the Full CPU Performance Equation

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 23, Page 24

The notes refine the earlier CPU-time equation by breaking total clock cycles into instruction-level factors. Total CPU clock cycles for a program equal the instruction count multiplied by the average clock cycles per instruction: `CPU clock cycles = Instructions for a Program x Average clock cycles per instruction`. The average cycles per instruction is abbreviated CPI, while instruction count is abbreviated IC. Substituting this into the earlier formula yields the full performance equation: `CPU time = IC x CPI x Clock Period`, or equivalently `CPU time = IC x CPI / clock rate`. The notes emphasize that instruction count depends on the program, ISA, and compiler. They illustrate this with a short code example compiled into four assembly instructions: `lw`, `add`, `sub`, `sw`. Not all instructions take the same number of cycles; some may take one cycle while others may take 5 or 15 because of events like waiting for memory. The notes also classify architectural influences on the equation: algorithm, programming language, compiler, ISA, and processor frequency each affect different factors. A comparison example shows that for the same ISA and program, a machine with 250 ps cycle time and CPI 2.0 is faster than one with 500 ps and CPI 1.2 because their per-instruction times are 500 ps and 600 ps respectively.

### Source snapshots

![Computer Architecture-2 Page 23](/computer-architecture/assets/computer-architecture-2-page-023.png)

![Computer Architecture-2 Page 24](/computer-architecture/assets/computer-architecture-2-page-024.png)

### Page-grounded details

#### Page 23

=> Instruction Performance

- The total number of clock cycles required to execute a program
depends on two factors. Since the compiler clearly generated
instructions to execute, and the computer had to execute the
instructions to run the program, the execution time must depend
on the number of instructions in a program. One way to think about
execution time is that it equals the number of instructions executed,
multiplied by the average time per instruction. Thus, the number of
clock cycles required for a program can be written as:

CPU clock cycles = Instructions for a Program x Average clock cycles
                              (Instruction count)      per instruction

Where the term clock cycles per instruction, which is the average number
of clock cycles each instruction takes to execute and abbreviated as CPI
and Instructions for a program, which is the number of assembly
instructions determined by the program itself, ISA (instruction set
architecture) or the compiler, abbreviated as IC (instruction count)

1 c/  int a = c + b
     int d = f - a
                 ---> compiler --->
lw $s2, 64($t4)
add $s1, $s2, $s4
sub $s1, $t0, $s3
sw $s1, 64($t4)      Thus program A contains

[Truncated for analysis]

#### Page 24

Therefore;

CPU time = Seconds/program = instructions/program x clock cycles/instructions x Seconds/clock cycle
                                      down IC                     down CPI                      down clock period (Tc)

-> CPU Performance consequently depends on:

- Algorithm : affects IC, possibly CPI

- Programming Language : affects IC, CPI

- compiler : affects IC, CPI

- ISA : affects IC, CPI, Tc

- Processor frequency : affects Tc

Nex/ Let computer A have cycle time = 250ps, CPI = 2 and
computer B have cycle time = 500ps, CPI = 1.2. Assume
both computers have the same ISA. Which one is faster
for the same program and by how much?

down Solution:  CPU timeA = IC x CPIA x cycle time A
                         = IC x 2.0 x 250ps = IC x 500ps     (A [unclear]/cycle)

             CPU timeB = IC x CPIB x cycle time B
                         = IC x 1.2 x 500ps = IC x 600ps

thus  CPU timeB / CPU timeA = IC x 600ps / IC x 500ps = 1.2 .  A is 1.2 times
faster than B

[Diagram meaning: downward arrows label the three factors in the CPU time equation as IC, CPI, and clock period (Tc). A downward arrow precedes "Solution:".]

### Key points

- Total clock cycles equal instruction count times average cycles per instruction.
- CPI is the average number of clock cycles each instruction takes.
- IC is the total number of instructions executed for the program.
- Full CPU-time equation: `CPU time = IC x CPI x Clock Period`.
- Equivalent form: `CPU time = IC x CPI / clock rate`.
- Algorithm, language, compiler, ISA, and frequency affect different terms in the equation.
- Lower CPI does not automatically imply faster execution if the clock period is longer.

### Related topics

- [[cpu-time-clocking-and-the-basic-performance-equation|CPU Time, Clocking, and the Basic Performance Equation]]
- [[performance-metrics-execution-time-cpu-time-and-response-time|Performance Metrics: Execution Time, CPU Time, and Response Time]]
- [[from-high-level-code-to-assembly-and-machine-language|From High-Level Code to Assembly and Machine Language]]

