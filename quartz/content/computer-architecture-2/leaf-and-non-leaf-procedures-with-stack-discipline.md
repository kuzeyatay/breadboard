---
title: "Leaf and Non-Leaf Procedures with Stack Discipline"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 76", "Page 77"]
related: ["functions-calling-convention-and-argument-passing", "stack-layout-stack-frames-and-push-pop-procedures", "recursive-factorial-execution-and-stack-frame-growth"]
tags: ["leaf-procedure", "non-leaf-procedure", "recursive-factorial", "stack-frame", "jal", "jalr"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-076-2.png", "/computer-architecture/assets/computer-architecture-2-page-077-2.png"]
---

## Leaf and Non-Leaf Procedures with Stack Discipline

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 76, Page 77

The notes distinguish leaf procedures, which do not call any other function, from non-leaf procedures, which do. In a leaf procedure, a function may still need a stack frame if it wants to reuse saved registers. The example `leaf_example` computes `(g + h) - (i + j)` with arguments in `a0-a3`, saves `s0` on the stack, performs calculations using temporaries `t0` and `t1`, copies the result to `a0`, restores `s0`, deallocates the stack slot, and returns with `jalr x0, 0(ra)`. Non-leaf procedures require stricter discipline because a nested `jal` overwrites `ra`. Therefore, any function that itself makes a call must save its own return address before the nested call. The recursive factorial example saves both `ra` and `a7`, checks the base case with `slti`, returns 1 for `n < 1`, or decrements `n` and recursively calls `fact`. After the recursive call returns, it restores the original `a7` and `ra`, pops the frame, multiplies `a0` by the saved `n`, and returns. This shows the full save-compute-restore structure of well-formed procedures.

### Source snapshots

![Computer Architecture-2 Page 76](/computer-architecture/assets/computer-architecture-2-page-076-2.png)

![Computer Architecture-2 Page 77](/computer-architecture/assets/computer-architecture-2-page-077-2.png)

### Page-grounded details

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

#### Page 77

You don't have to program nested functions in Exom?B

Non-Leaf Procedures: A non-leaf procedure is a function that itself
calls another function, also named Nested procedures. The moment a function
calls another function, the function will execute another `jal`, and that new call
will write a new return address into `ra`, so when the current (parent) function
needs its old return address, then it must have saved that old `ra` value before
making the nested call.

ex/ Recursive factorial function:

int fact(int n){
    if (n < 1) return 1.
    else return n * fact(n-1)
}

let the argument n be kept in a7 and the result is returned in a0, assume n = 3

fact:
    addi sp, sp, -8          // adjust stack for 2 items (ra and a7)
    sw ra, 4(sp)             // save return adress value
    sw a7, 0(sp)             // save argument value
    slti t0, a7, 1           // test for n < 1
    beq t0, zero, L1
    addi a0, zero, 1         // if n < 1, result is 1
    addi sp, sp, 8           // pop 2 items from stack
    jalr x0, 0(ra)           // return to [end]

L1: addi a7, a7, -1         // else decrement n by 1
    jal ra, fact            // recursive call back to parent function fact

re

[Truncated for analysis]

### Key points

- A leaf procedure does not call another function.
- A non-leaf procedure makes at least one nested call.
- Leaf procedures may still allocate stack space to save callee-saved registers.
- Non-leaf procedures must save `ra` before executing another `jal`.
- Recursive procedures also save argument values needed after the call.
- Function bodies are organized into prologue, computation, epilogue, and return.

### Related topics

- [[functions-calling-convention-and-argument-passing|Functions, Calling Convention, and Argument Passing]]
- [[stack-layout-stack-frames-and-push-pop-procedures|Stack Layout, Stack Frames, and Push/Pop Procedures]]
- [[recursive-factorial-execution-and-stack-frame-growth|Recursive Factorial Execution and Stack Frame Growth]]

### Relationships

- example-of: [[recursive-factorial-execution-and-stack-frame-growth|Recursive Factorial Execution and Stack Frame Growth]]
