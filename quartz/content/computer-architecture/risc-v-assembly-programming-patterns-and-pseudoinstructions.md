---
title: "RISC-V Assembly Programming Patterns and Pseudoinstructions"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 79", "Page 80", "Page 81", "Page 82", "Page 83", "Page 84"]
related: ["i-type-immediates-loads-and-compare-instructions", "branch-instructions-and-pc-relative-control-flow", "functions-calling-convention-and-argument-passing", "assembly-directives-system-calls-and-simulator-commands"]
tags: ["pseudoinstruction", "call", "assembly", "loop"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-079-2.png", "/computer-architecture/assets/computer-architecture-2-page-080-2.png"]
---

## RISC-V Assembly Programming Patterns and Pseudoinstructions

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 79, Page 80, Page 81, Page 82, Page 83, Page 84

Several pages use complete assembly examples to teach common programming patterns in RISC-V. The array-sum function initializes loop variables in saved registers, compares `i < n` using `slt`, exits with `beq`, computes an array element address by shifting the index left by 2 and adding it to the base pointer, loads the word, accumulates into `sum`, increments the index, and jumps back to the loop start. The notes explain that shifting by 2 multiplies by 4 because each integer occupies 4 bytes. Later examples extend this to full programs with terminal I/O, prompts stored in the data segment, and function calls. These pages also define pseudoinstructions as convenient assembler shorthands that expand into real ISA instructions. Examples include `jr ra -> jalr x0, 0(ra)`, `mv rd, rs -> addi rd, rs, 0`, `li rd, imm -> addi rd, x0, imm`, `j label -> jal x0, label`, and `call label -> jal ra, label`. The examples show how pseudoinstructions improve readability without changing underlying execution semantics.

### Source snapshots

![Computer Architecture-2 Page 79](/computer-architecture/assets/computer-architecture-2-page-079-2.png)

![Computer Architecture-2 Page 80](/computer-architecture/assets/computer-architecture-2-page-080-2.png)

### Page-grounded details

#### Page 79

- RISC-V Assembly Examples / Debugging

[Ex?]/A sum function that adds up all elements of an integer array.
let "i" be stored in s0 and "sum" in s1, "n" in a1    Pointer "values" in a0
in C

int sum(int *values, int n) {
    int i, sum;
    i = 0;
    sum = 0;
    while (i < n) {                     [note with arrow to `values[i]`: base memory address]
        sum = sum + values[i];
        i = i + 1;
    }

    return sum;
}

->

sum:
    addi sp, sp, -8        # increase stack
    sw s0, 4(sp)           # push s0 "i" on stack
    sw s1, 0(sp)           # push s1 "sum" on stack
    add s0, zero, zero     # i = 0
    add s1, zero, zero     # sum = 0

L1:
    slt t0, s0, a1         # t0 = 1 if s0 < a1
    beq t0, zero, L2       # if t0 = 0 (i >= n) go to L2
    sll t3, s0, 2          # t3 = s0 * 4
    add t1, a0, t3         # add the base address of
                           # the array to the byte
    lw t2, 0(t1)           # load values[i] to the
                           # values[i]th value
    add s1, s1, t2         # s1 = s1 + t2 (sum = sum + values[i])
    addi s0, s0, 1         # increment i  (i = i + 1)
    beq zero, zero, L1     # Jump to the start

[Truncated for analysis]

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

### Key points

- Loop conditions are commonly implemented with `slt` plus `beq`.
- Array indexing uses `sll index, index, 2` to multiply by 4-byte word size.
- Results are often moved into `a0` before return or system calls.
- Pseudoinstructions are assembler shorthands, not hardware instructions.
- `jr`, `mv`, `li`, `j`, and `call` each expand to concrete ISA instructions.
- Real programs use `.text` for code and `.data` for stored strings and arrays.

### Related topics

- [[i-type-immediates-loads-and-compare-instructions|I-Type Immediates, Loads, and Compare Instructions]]
- [[branch-instructions-and-pc-relative-control-flow|Branch Instructions and PC-Relative Control Flow]]
- [[functions-calling-convention-and-argument-passing|Functions, Calling Convention, and Argument Passing]]
- [[assembly-directives-system-calls-and-simulator-commands|Assembly Directives, System Calls, and Simulator Commands]]

### Relationships

- related: [[assembly-directives-system-calls-and-simulator-commands|Assembly Directives, System Calls, and Simulator Commands]]
