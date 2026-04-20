---
title: "Recursive Factorial Execution and Stack Frame Growth"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 78"]
related: ["leaf-and-non-leaf-procedures-with-stack-discipline", "stack-layout-stack-frames-and-push-pop-procedures", "functions-calling-convention-and-argument-passing"]
tags: ["factorial", "stack-frame", "forward-pass", "backward-pass"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-078-2.png"]
---

## Recursive Factorial Execution and Stack Frame Growth

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 78

The factorial example is expanded into a visual model of recursion and stack usage. Each active call to `fact(n)` gets its own stack frame containing at least the saved return address and saved argument value. The forward pass of recursion creates successive frames for `n = 3`, `n = 2`, `n = 1`, and `n = 0`, each with a different saved `ra` and `a7`. The backward pass then unwinds the stack: the base case returns `a0 = 1` for `n = 0`, and each returning frame restores its own saved `n` from `a7`, multiplies it by the returned value in `a0`, and returns again. The page explicitly tracks the intermediate results: for `n = 1`, `a0 = 1`; for `n = 2`, `a0 = 1 x 2 = 2`; for `n = 3`, `a0 = 2 x 3 = 6`. The diagrams emphasize that recursion is not a special execution mode; it is repeated ordinary function calling, with one new frame per call and one pop per return.

### Source snapshots

![Computer Architecture-2 Page 78](/computer-architecture/assets/computer-architecture-2-page-078-2.png)

### Page-grounded details

#### Page 78

Main Program(caller)

[diagram: a box labeled main program/caller points right to a sequence of stack-frame boxes for recursive `fact(n)` calls; curved arrows show returns back leftward/upward. A long curved arrow above is labeled "forward pass"; a curved arrow below is labeled "Backward Pass".]

fact(n) | n=3
Stack
frame 1

fact(n) | n=2
stack
frame
2

fact(n) | n=1
stack
frame
3

fact(n) | n=0
stack
frame
4

each instance of fact creates a new stack
frame

forward pass

Return to main.

return to complete
the fact(n) | n=3

return to complete
the fact(n) | n=2

return to complete
the fact(n) | n=1

Backward
Pass

- Forward Pass

Frame1.
ra = address of
ouriginal caller
a7 = 3

Frame2.
ra = fact(3)
a7 = 2

Frame3.
ra = fact(2)
a7 = 1

Frame4.
ra = fact(1)
a7 = 0

[diagram: vertical stack/frame layout with braces on the right marking values `n=3`, `n=2`, `n=1`, `n=0`; arrows at each level labeled `sp` and `fp`; top arrow labeled `f.p`, another near upper section labeled `s.p` and `f.p`.]

backward Pass

ra = address of original
caller
a7 = 3

ra = fact(3)  X
a7 = 2

ra = fact(2)  X
a7 = 1

ra = fact(1)  X
a7 = 0

[diagram: matching vertical stack layout for unwind/return path; arro

[Truncated for analysis]

### Key points

- Every recursive call allocates a new stack frame.
- The forward pass pushes frames until the base case is reached.
- The base case for factorial returns 1.
- The backward pass restores saved values and combines results.
- Each frame has its own saved return address and saved argument.
- The final result emerges during stack unwinding rather than during descent.

### Related topics

- [[leaf-and-non-leaf-procedures-with-stack-discipline|Leaf and Non-Leaf Procedures with Stack Discipline]]
- [[stack-layout-stack-frames-and-push-pop-procedures|Stack Layout, Stack Frames, and Push/Pop Procedures]]
- [[functions-calling-convention-and-argument-passing|Functions, Calling Convention, and Argument Passing]]

### Relationships

- depends-on: [[stack-layout-stack-frames-and-push-pop-procedures|Stack Layout, Stack Frames, and Push/Pop Procedures]]
