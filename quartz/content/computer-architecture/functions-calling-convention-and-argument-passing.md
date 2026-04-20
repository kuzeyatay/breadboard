---
title: "Functions, Calling Convention, and Argument Passing"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 73", "Page 74"]
related: ["jump-and-link-jalr-and-function-return-mechanics", "stack-layout-stack-frames-and-push-pop-procedures", "leaf-and-non-leaf-procedures-with-stack-discipline"]
tags: ["function", "calling-convention", "saved-registers", "temporary-registers"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-073-2.png", "/computer-architecture/assets/computer-architecture-2-page-074-2.png"]
---

## Functions, Calling Convention, and Argument Passing

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 73, Page 74

The notes define a function as a labeled block of instructions in instruction memory and emphasize that successful calls require a shared convention between caller and callee. The caller must place arguments where the callee expects them, transfer control to the function entry, allow temporary storage, receive the result in the agreed location, and resume at the correct next instruction. RISC-V uses registers `a0` through `a7` for the first eight arguments, and the same registers are also used for return values, with `a0` as the primary return register. A worked example shows `main` loading values into `a0` and `a1`, executing `jal ra, fnct_sum`, and the callee computing the sum in `a0` before returning with `jalr x0, 0(ra)`. The notes then explain register preservation rules: temporary registers `t0`-`t6` and argument registers `a0`-`a7` may be freely overwritten by the callee, but saved registers `s0`-`s11` must be preserved if used. This preservation requirement motivates the stack.

### Source snapshots

![Computer Architecture-2 Page 73](/computer-architecture/assets/computer-architecture-2-page-073-2.png)

![Computer Architecture-2 Page 74](/computer-architecture/assets/computer-architecture-2-page-074-2.png)

### Page-grounded details

#### Page 73

Lecture 1-2 week 4

=> Functions in RISC-V

- A function in RISC-V is a labeled block of instructions stored in
instruction memory. At the C level, a function looks like a "named computation"
that accepts inputs and produces an output.

down
[Diagram: a vertical memory layout with boxed address ranges and arrows]

[left label beside upper box]
instructions
of main
program
(caller)

[upper box entries, top to bottom]
0xFFFFFFF3 (1 byte)
0xFFFFFFF2 (1 byte)
0xFFFFFFF1 (1 byte)
0xFFFFFFF0 (1 byte)
.
.

[right side of upper/lower diagram]
result = procedureA(int g, h, i, j);
printf("%d", result);

up
(return)

[left label beside lower tall box]
instructions
of function
(callee)

[lower box entries, top to bottom]
0x0000000C (1 byte)
0x0000000B (1 byte)
0x0000000A (1 byte)
0x00000009 (1 byte)
0x00000008 (1 byte)
0x00000007 (1 byte)
0x00000006 (1 byte)
0x00000005 (1 byte)

(right bracket label)
(jump)

int ProcedureA (int g, h, i, j) {
    int f;
    f = (g + h) - (i + j)
    return f;
}

[continuation of lower box entries below]
0x00000004 (1 byte)
0x00000003 (1 byte)
0x00000002 (1 byte)
0x00000001 (1 byte)

[right bracket label spanning lower-most entries]
1 instruction

up
Memory addr

[Truncated for analysis]

#### Page 74

downThe next question is where arguments and results live. RISC-V uses
a register convention for that. The first eight argument registers are
a0 through a7, and the same registers are also used for return values,
with a0 being the primary return register.

NEX/

// in c code                               // Assembly
                                            PC
                                            ──
                                            1000    main: add a0, s0, zero   // x=a+0
main() {                                    1004        add a1, s1, zero   // y=b+0
int a, b;                                   1008        jal ra, fnct_sum   // ra=1008+4=1012
c = fnct_sum(a,b);                                              jump to sum
...                                         1012        ...
}
...
int fnct_sum(int x, int y) {                2000    fnct_sum: add a0, a0, a1   // x=x+y
return (x+y);                               2004        jalr x0, 0(ra)   // jump to 1012
}

[diagram: a right-pointing arrow from the C code on the left to the Assembly on the right]

downQuite often, our function needs to use registers to do some calculations, so
the function will modify the v

[Truncated for analysis]

### Key points

- Functions are labeled instruction blocks in memory.
- The caller and callee follow a fixed register convention.
- `a0-a7` hold the first eight arguments.
- `a0` is the primary return-value register.
- `jal` transfers control and writes the return address into `ra`.
- Temporary and argument registers are caller-saved in practice.
- Saved registers `s0-s11` must be preserved by the callee if reused.

### Related topics

- [[jump-and-link-jalr-and-function-return-mechanics|Jump and Link, JALR, and Function Return Mechanics]]
- [[stack-layout-stack-frames-and-push-pop-procedures|Stack Layout, Stack Frames, and Push/Pop Procedures]]
- [[leaf-and-non-leaf-procedures-with-stack-discipline|Leaf and Non-Leaf Procedures with Stack Discipline]]

### Relationships

- causes: [[stack-layout-stack-frames-and-push-pop-procedures|Stack Layout, Stack Frames, and Push/Pop Procedures]]
- depends-on: [[leaf-and-non-leaf-procedures-with-stack-discipline|Leaf and Non-Leaf Procedures with Stack Discipline]]
