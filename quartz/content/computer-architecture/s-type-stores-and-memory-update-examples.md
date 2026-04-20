---
title: "S-Type Stores and Memory Update Examples"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 67", "Page 68"]
related: ["load-store-architecture-and-byte-addressable-memory", "i-type-immediates-loads-and-compare-instructions", "functions-calling-convention-and-argument-passing", "single-cycle-processor-datapath-and-control-overview"]
tags: ["s-type", "offset", "base-register", "memory-address"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-067-2.png", "/computer-architecture/assets/computer-architecture-2-page-068-2.png"]
---

## S-Type Stores and Memory Update Examples

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 67, Page 68

S-type instructions implement storing a register value into memory at an address computed from another register plus a small offset. Their layout splits the immediate across two fields: `imm[11:5] | rs2 | rs1 | funct3 | imm[4:0] | opcode`. Here `rs1` is the base register used in the address calculation and `rs2` is the source register whose value is written to memory. The notes use `sw x9, 4(x22)` as the canonical example, where a word from x9 is stored to the memory address `x22 + 4`. A compilation example translates `A[2] = h + j` into `add t0, s2, s4` followed by `sw t0, 8(s3)`, using offset 8 because `A[2]` is the third 4-byte word. Another example combines load, add, and store to implement `A[2] = h + A[1]`, and a final swap example shows how loads and stores can exchange memory-resident variables `a` and `b` using temporary registers. The page also lists store variants such as `sb`, `sh`, and `sw`.

### Source snapshots

![Computer Architecture-2 Page 67](/computer-architecture/assets/computer-architecture-2-page-067-2.png)

![Computer Architecture-2 Page 68](/computer-architecture/assets/computer-architecture-2-page-068-2.png)

### Page-grounded details

#### Page 67

S-type instructions

- An S-type instruction is the standard way to say "write a value from a
register into memory at an address computed from another register
plus a small constant offset."

down ex/      sw x9, 4(x22)        // store a word from register x9 to
          (store word)          memory adress given in x22 + 4 bytes

31|30|29|28|27|26|25|24|23|22|21|20|19|18|17|16|15|14|13|12|11|10|9|8|7|6|5|4|3|2|1|0
|   imm[11:5]   |   rs2   |   rs1   | funct3 | imm [4:0] | opcode |
    7 bits         5 bits    5 bits    3 bits    5 bits     7 bits

down
down ex/ for   sw x9  4(x22)

   7              5         5      3      5         7
| 0000000 |     10110 |   01001 | 010 | 00100 | 0100011 |

          down                 d         down                  down
       base register      source    funct3            opcode for sw
       x22 in bin         register   for sw
                          x9 in bin

down
adress offset :
4 in binary (000000000100)

down ex/ compile the c code: A[2] = h + j,   h is in s2, j in s4,
base adress of A in s3

down solution
    add t0, s2, s4
    sw  t0  8(s3)

-> examples of load commands

- lw                          - lh (load half)

- lb (load

[Truncated for analysis]

#### Page 68

down ex/ compile the c code:  A[2] = h + A[1]   h in S2   base address of A
in S3.

downSolution

                lw t0, 4(S3)
                add t0, S2, t0
                sw t0, 8(S3)

down ex/ compile the c code:

{
    int temp;
    temp = a;
    a = b;
    b = temp;
}

the compiler has decided x18 = adress of a, x19 = adress of b, x20 = temp1
x21 = temp2

downsolution:

                lw x20, 0(x18)   // load a into x20
                lw x21, 0(x19)   // load b into x21
                sw x21, 0(x18)   // store x21 (=b) into a
                sw x20, 0(x19)   // store x20 (=a) into b

-> examples of store comands:

- Sb (Store byte)

- Sh (store half)

- Sw

### Key points

- S-type is used for writing register values into memory.
- The immediate offset is split across two instruction fields.
- Address calculation uses base register plus signed offset.
- In `sw x9, 4(x22)`, x22 is the base register and x9 is the source register.
- Array indexing uses byte offsets, so `A[2]` in a word array uses offset 8.
- Stores are commonly paired with loads and ALU operations in load/store programs.

### Related topics

- [[load-store-architecture-and-byte-addressable-memory|Load-Store Architecture and Byte-Addressable Memory]]
- [[i-type-immediates-loads-and-compare-instructions|I-Type Immediates, Loads, and Compare Instructions]]
- [[functions-calling-convention-and-argument-passing|Functions, Calling Convention, and Argument Passing]]
- [[single-cycle-processor-datapath-and-control-overview|Single-Cycle Processor Datapath and Control Overview]]

### Relationships

- applies-to: [[single-cycle-processor-datapath-and-control-overview|Single-Cycle Processor Datapath and Control Overview]]
