---
title: "Load-Store Architecture and Byte-Addressable Memory"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 65", "Page 66", "Page 67", "Page 68"]
related: ["instruction-set-architecture-rv32i-registers-and-memory-basics", "i-type-immediates-loads-and-compare-instructions", "s-type-stores-and-memory-update-examples"]
tags: ["load-store-architecture", "byte-addressable", "word", "memory", "offset"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-065-2.png", "/computer-architecture/assets/computer-architecture-2-page-066-2.png"]
---

## Load-Store Architecture and Byte-Addressable Memory

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 65, Page 66, Page 67, Page 68

A central architectural principle in the notes is that RV32I is a load/store architecture. Arithmetic and logic operate only on register values, while most program data lives in main memory. Therefore realistic programs repeatedly load data from memory into registers, compute using ALU instructions, and store results back to memory. The memory system is byte-addressable: each address names one 8-bit byte even though the CPU often transfers 32 bits at once. A word therefore occupies four consecutive byte addresses, and consecutive words begin 4 bytes apart. This model underlies address calculation for arrays and structured data. The notes tie this to instruction formats by introducing I-type for immediates and loads, and S-type for stores. In both cases an effective address is computed as a base register plus a small immediate offset. This is the standard addressing mode used for local variables, arrays, and stack accesses.

### Source snapshots

![Computer Architecture-2 Page 65](/computer-architecture/assets/computer-architecture-2-page-065-2.png)

![Computer Architecture-2 Page 66](/computer-architecture/assets/computer-architecture-2-page-066-2.png)

### Page-grounded details

#### Page 65

- RV32I is a load/store architecture, the CPU can only perform
arithmetic and logic operations on values that are already inside the
register file. Meanwhile, most program data such as: some variables,
arrays, structures live in main memory, which is much larger but slower
thus, any realistic program repeatedly loads a value from memory
into a register, computes using register only ALU instructions, and stores
the result back into the ALU when needed

down Another important fact is that RV32 memory is byte-addressable meaning
a memory address names a single 8 bit byte. Even though CPU often
transfers 32 bits at once, addresses still count in bytes: address 0,1,2,3
refer to four consecutive bytes. The CPU reads 4 consecutive bytes to
get a single stored word, because a word is 32 bits.

[diagram: vertical stack of four memory cells bracketed together as "word 0"; dots above and below indicate continuation]
0x00000007    base
0x00000006    base+1
0x00000005    base+2
0x00000004    base+3

-> Because the adress space is byte
indexed, the start addresses of
consecutive words differ by 4.

↳ Word 0 starts at base
↳ word 1 starts at base+4
↳ word 2 starts at base+8 ...

I type Format

31

[Truncated for analysis]

#### Page 66

The second use is **loads**. The data transfer instruction that copies
data from memory to a register is called load.

down ex/
`lw  x9  32(x22)`
(load word)
              down
         adress offset
      (constant = immediate)
                        ↘ base adress.

down ex/ Assume that A is an array of 5 words and that the compiler has associated
the variables g and h with the registers x20 an x21 as before. Assume
the base adress of the array is in x22. Compile this C statement

`g = h + A[1]`

down Solution:
             temp variable          base adress
`lw  t0,  4(x22)`
           ↳ offset constant

`add  x20,  x21,  t0`

down ex/
`lw  x9  32(x22)`

| address ofset | rs1 | funct3 | rd | opcode |
|---|---|---|---|---|
| `000000100000` | `10110` | `010` | `01001` | `0000011` |

down under `address ofset`:
adress ofset
(32 in binary)

down under `rs1`:
22 in binary

down under `funct3`:
funct3
for lw
(2 in binary)

down under `rd`:
9 in binary

down under `opcode`:
Operation code
for load type

down the third are some conditions

down ex/                              -> (R-format)
`slt  x5, x6, x7`   =>   if (x6 < x7) {x5 = 1} else {x5 = 0}

down `slti  t0, s0, 25`     immedia

[Truncated for analysis]

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

- RV32I performs ALU operations only on register contents.
- Program data such as arrays and structures mainly reside in main memory.
- Memory is byte-addressable, so addresses count bytes rather than words.
- A 32-bit word occupies four consecutive bytes.
- Consecutive words start at addresses base, base+4, base+8, and so on.
- Loads move memory data into registers; stores move register data into memory.
- Effective addresses use base-register-plus-offset addressing.

### Related topics

- [[instruction-set-architecture-rv32i-registers-and-memory-basics|Instruction Set Architecture, RV32I, Registers, and Memory Basics]]
- [[i-type-immediates-loads-and-compare-instructions|I-Type Immediates, Loads, and Compare Instructions]]
- [[s-type-stores-and-memory-update-examples|S-Type Stores and Memory Update Examples]]

### Relationships

- depends-on: [[i-type-immediates-loads-and-compare-instructions|I-Type Immediates, Loads, and Compare Instructions]]
- depends-on: [[s-type-stores-and-memory-update-examples|S-Type Stores and Memory Update Examples]]
