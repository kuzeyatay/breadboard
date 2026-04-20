---
title: "Stack Layout, Stack Frames, and Push/Pop Procedures"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 75", "Page 76"]
related: ["functions-calling-convention-and-argument-passing", "leaf-and-non-leaf-procedures-with-stack-discipline", "recursive-factorial-execution-and-stack-frame-growth"]
tags: ["stack", "stack-frame", "push", "pop", "lifo", "memory-layout"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-075-2.png", "/computer-architecture/assets/computer-architecture-2-page-076-2.png"]
---

## Stack Layout, Stack Frames, and Push/Pop Procedures

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 75, Page 76

The stack is introduced as the memory region used when functions need temporary storage to preserve register values, save return addresses, or hold local data. The rough memory layout places the stack near high addresses, growing downward toward lower addresses, while code, static data, dynamic data, and reserved operating-system regions occupy other parts of memory. The stack behaves as LIFO storage, and register `sp` (x2) points to the current stack end. The notes define a stack frame as the portion of the stack belonging to one active function call. A typical frame may contain saved argument registers, a saved return address, saved local registers, and local arrays or structures. They give explicit push and pop sequences: pushing a word uses `addi sp, sp, -4` followed by `sw s0, 0(sp)`, while popping uses `lw s0, 0(sp)` followed by `addi sp, sp, 4`. The frame pointer `fp`/x8 is also introduced as a stable base for frame-relative addressing even if `sp` changes during execution.

### Source snapshots

![Computer Architecture-2 Page 75](/computer-architecture/assets/computer-architecture-2-page-075-2.png)

![Computer Architecture-2 Page 76](/computer-architecture/assets/computer-architecture-2-page-076-2.png)

### Page-grounded details

#### Page 75

Su  Mo  Tu  We  Th  Fr  Sa

No. __________
Date      /    /

✩. A rough memory layout

[Diagram: vertical memory map box at left]
- Left labels:
  x7FFFFFFC
  x10000000
  x400000
- Main regions inside box from top to bottom:
  (Stack)  [label written to the right of the top region]
  [middle empty region with one arrow pointing downward and one arrow pointing upward]
  Dynamic Data
  Static Data
  [arrow to right] heap
  (code globals/static)  [bracketed note to the right]
  Data
  Memory
  Text Segment
  (program instructions)
  Reserved
- Notes under bottom:
  reserve for
  OS operations

-> If a function must preserve an old register value before reusing that register for its own work, it needs some other storage location. The stack is that storage, The stack starts near a high address and grows downward toward lower addresses. The stack also behaves like a pile. The most recent thing "pushed" onto it is the first one to be removed, which is called a LIFO queue (last-in, first-out)

- Empty stack

High adress

[Diagram: stack boxes]
x7FFFFFC10
x7FFFFFB11
x7FFFFFA12
x7FFFFF913

<- Top (FP)
  push data
  push data
  current end
  of the stack (SP)

grows down
from high
address to

[Truncated for analysis]

#### Page 76

\ The part of the stack belonging to one active function call that we discussed
is called the procedure frame or stack frame. A frame pointer fp/x8
is used to point to the begining of this frame so that local memory references
have a stable base even if sp changes during execution.

- fp is initialized using the value in sp upon a call

- sp is restored using the value in fp pon a return

▽ To keep thing simple & effective, we generally try to clean the stack
- per function call, since memory is limited and if the stack is too big,
it extends to the large memory, slowing things 500 times slower.

=> Leaf Procedures
- A leaf procedure is a function that dosn't call any other function.

ex/

int leaf_example(int g, int h, int i, int j) {
    int f;  // local variable
    f = (g + h) - (i + j);
    return f;
}

At the Assembly level, the incoming arguments g, h, i, j are placed in a0, a1,
a2, a3. Suppose we decide to store the local variable f in s0, the old value of
s0 must be saved before s0 is reused and restored before the function returns.
a0 is also reused to store the return result.

leaf:    addi sp, sp, -4    allocate memory
         sw   s0, 0(sp)     {save value in s0 to

[Truncated for analysis]

### Key points

- The stack provides storage for active function calls.
- It starts at high addresses and grows downward.
- The stack uses LIFO behavior.
- `sp` points to the current stack end.
- A stack frame belongs to one active procedure call.
- Frames may contain saved arguments, return address, saved registers, and local data.
- Push decrements `sp` before storing; pop loads then increments `sp`.
- `fp` provides a stable reference point inside a frame.

### Related topics

- [[functions-calling-convention-and-argument-passing|Functions, Calling Convention, and Argument Passing]]
- [[leaf-and-non-leaf-procedures-with-stack-discipline|Leaf and Non-Leaf Procedures with Stack Discipline]]
- [[recursive-factorial-execution-and-stack-frame-growth|Recursive Factorial Execution and Stack Frame Growth]]

### Relationships

- applies-to: [[leaf-and-non-leaf-procedures-with-stack-discipline|Leaf and Non-Leaf Procedures with Stack Discipline]]
