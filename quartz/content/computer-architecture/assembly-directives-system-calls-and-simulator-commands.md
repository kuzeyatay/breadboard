---
title: "Assembly Directives, System Calls, and Simulator Commands"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 80", "Page 81", "Page 82", "Page 83", "Page 84", "Page 85"]
related: ["risc-v-assembly-programming-patterns-and-pseudoinstructions", "functions-calling-convention-and-argument-passing", "single-cycle-processor-datapath-and-control-overview"]
tags: ["assembly-directives", "ascii", "space", "spike", "system-call", "debug"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-080-2.png", "/computer-architecture/assets/computer-architecture-2-page-081-2.png"]
---

## Assembly Directives, System Calls, and Simulator Commands

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 80, Page 81, Page 82, Page 83, Page 84, Page 85

The notes distinguish three supporting layers around assembly programming: assembler directives, system calls, and simulator/debug commands. Directives are commands to the assembler rather than the CPU and control how code and data are laid out in memory. The pages list `.text` for the instruction section, `.data` for the data section, `.ascii` to store strings without an added null terminator, `.byte`, `.word`, `.float`, `.double`, and `.space` to reserve raw storage. For program interaction with the operating environment, the notes use system calls such as `read_int`, `print_int`, `print_string`, and `exit`, with arguments passed in `a0`, `a1`, and so on. Example programs demonstrate prompt strings in `.data`, input loops, and output of computed sums. Finally, the debugging page introduces SPIKE as the RISC-V ISA simulator for the course and lists commands such as `until pc 0 <address>`, `r <count>`, `reg 0`, `h`, and `q`. The page also defines a core as an individual execution unit with its own program counter, register file, and control logic.

### Source snapshots

![Computer Architecture-2 Page 80](/computer-architecture/assets/computer-architecture-2-page-080-2.png)

![Computer Architecture-2 Page 81](/computer-architecture/assets/computer-architecture-2-page-081-2.png)

### Page-grounded details

#### Page 80

down ex2/ add two numbers that are red from the input terminal. The
Goal is to write an entire assembly program that actually
runs with main and imports. For OS operations, we use system calls:

                 funct             result
- Print_int     => a0 holding integer
- Print_string => a0 holding address of strings
- read_int     => returns integer in a0
- exit         => terminates the program

down In Risc-V calling convention used here, the first argument of a function
or a system call is passed in register a0, and additional arguments
are passed in a1, a2 and so on.

down C code
____________

int main() {

    int a, b, sum;

    a = read_int();
    b = read_int();
    sum = a + b;
    print_int(sum);
}

down Assembly
                 p. assembly directive

.text                                     // says "the following lines
                                          belong to the code
                                          section, i.e instructions"

main:

call read_int                             // read integer from keyboard
mv s0, a0                                 // move the number into s0
[arrow labeled "system call" points to `call`]

call read_int

[Truncated for analysis]

#### Page 81

V(c3/  sum N numbers with N specified by the input terminal (user).
down

int main() {

    int n, sum = 0

    Print_String("How many inputs?");

    n = read_int();

    while (n > 0) {

        Print_String("next input:");

        sum = sum + read_int();

        n = n - 1;
    }

    Print_String("The sum is ");

    Print_int(sum);
}

possibly directive stating constant data memory

.data

Prompt1:  .ascii  "How many inputs?\0"

Prompt2:  .ascii  "Next input: \0"

sumout:   .ascii  "The sum is \0"
          -> directive stating: store the string
            in memory without \0.

-> .text

main:

load address  <-  la  a0, prompt1    // load the address of
                                    // prompt1 to a0

    call Print_String    // print prompt1

    call read_int

    mv  s0, a0    // store n in s0          number of inputs

load immediate
to s1
(addi rd, r0, imm)   <-   li  s1, 0    // sum stored in s1, initialized
                                       // to zero.

while:

Branch if less or equal
to zero (bge x0, s0, endwhile)
(s0 <= 0)            <-   blez  s0, endwhile

    la  a0, Prompt2    // load adress to a0
                       // (of prompt2)

    call print

[Truncated for analysis]

#### Page 82

ex 4/ Sum N numbers using function

. C Code                                              - Assembly:

int sum(int * values, int n) {                         .data
    int i, sum,                                        Prompt1:    .ascii "How many inputs (max 100?)\10"
    i = 0;                                             Prompt2:    .ascii "Next input : \10"
    sum = 0;                                           sumout:     .ascii "Next input : \10"
    while (i < n) {                                    values:     .space 400     // reserve space for 100 int
        Sum = sum + values[i];
        i = i + 1;
    }
}                                                      .text
                                                       sum:
Void main(void) {                                          addi sp, sp, -8
    int n, i, values[100], result;                         sw   s0, 4(sp)
    Print_string("How many inputs (max 100?)");           sw   s1, 0(sp)
    n = read_int();                                       add  s0, zero, zero
    while (i < 100 && i < n) {                            add  s1, zero, zero
        print_string("next input: ");
        values[i] = read_int();

[Truncated for analysis]

#### Page 83

main:

la a0, prompt1

call print_string

call read_int

move s0, a0


li s1, 0


while:

li t0, 100

slt t1, s1, t0

beq t1, zero, endwhile


slt t1, s1, s0

beq t1, zero, endwhile


la a0, prompt2

call print_string

call read_int


la t2, values

sll t3, s1, 2

add t2, t2, t3

sw a0, 0(t2)


addi s1, s1, 1

j while


endwhile:

move a0, values  // argument1: address
move a1, s0      // argument2: n

jal sum          // call function sum

move s1, a0      // move result of function call to s1


la a0, sumout

call print_string

move a0, s1

call print_int

call exit

ret

added here
(completes
next exercise)

### Key points

- Assembler directives describe memory placement rather than runtime CPU actions.
- `.text` marks instructions and `.data` marks initialized data.
- `.ascii` stores strings without appending `\0`.
- `.space` reserves a block of bytes in memory.
- System calls use argument registers beginning with `a0`.
- SPIKE is the simulator used in the course.
- Debug commands can run until a PC value, step instructions, or inspect registers.

### Related topics

- [[risc-v-assembly-programming-patterns-and-pseudoinstructions|RISC-V Assembly Programming Patterns and Pseudoinstructions]]
- [[functions-calling-convention-and-argument-passing|Functions, Calling Convention, and Argument Passing]]
- [[single-cycle-processor-datapath-and-control-overview|Single-Cycle Processor Datapath and Control Overview]]

### Relationships

- applies-to: [[functions-calling-convention-and-argument-passing|Functions, Calling Convention, and Argument Passing]]
