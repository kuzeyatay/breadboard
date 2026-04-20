---
title: "Unsigned Binary Arithmetic"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 13", "Page 14", "Page 15"]
related: ["unsigned-binary-representation-and-conversion-procedures", "signed-integer-representations", "overflow-underflow-and-language-level-handling", "half-adder-full-adder-and-ripple-carry-addition"]
tags: ["unsigned-addition", "unsigned-subtraction", "unsigned-multiplication", "carry-bit", "borrow-bit", "shift-and-add", "alu"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-013.png", "/computer-architecture/assets/computer-architecture-2-page-014.png"]
---

## Unsigned Binary Arithmetic

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 13, Page 14, Page 15

The notes describe unsigned arithmetic by direct analogy to elementary school arithmetic, but in base 2. Unsigned addition produces a sum bit and possibly a carry bit that propagates to the next higher position. The fundamental cases are `0+0=0`, `1+0=1`, `0+1=1`, `1+1=(1)0`, and `1+1+1=(1)1`, where the parenthesized bit is the carry. A worked example adds `000111` and `000110` to obtain `001101`, which equals decimal 13. Unsigned subtraction follows the same positional logic but introduces borrowing; one shown principle is `0 - 1 = (-1)1`, indicating a borrow. Multiplication is described as shift-and-add, again mirroring handwritten multiplication; the example multiplies binary `1010` by `101` to get `110010`. Division is listed as the next unsigned arithmetic operation, though no detailed procedure is developed in this chunk. This topic matters because later signed arithmetic in two's complement reuses ordinary binary addition hardware, making unsigned arithmetic the base mechanism for integer ALUs.

### Source snapshots

![Computer Architecture-2 Page 13](/computer-architecture/assets/computer-architecture-2-page-013.png)

![Computer Architecture-2 Page 14](/computer-architecture/assets/computer-architecture-2-page-014.png)

### Page-grounded details

#### Page 13

↳ Converting Decimal to binary (unsigned)

- To convert a nonnegative decimal integer to binary, repeatedly divide by
2 and record remainders, if there is no remainder, note 0, if there is
a remainder note 1.

down ex/ 4382 in base 2 equals ?

down Solution

4382   | 2   -> 0
2191   | 2   -> 1
1095   | 2   -> 1
547    | 2   -> 1
273    | 2   -> 1
136    | 2   -> 0
68     | 2   -> 0
34     | 2   -> 0
17     | 2   -> 1
8      | 2   -> 0
4      | 2   -> 0
2      | 2   -> 0
1      | 2   -> 1
0

[Right-side upward arrow indicating the remainders are read from bottom to top]

=> 1000100011110

↳ Unsigned Integer Arithmetic

1. Unsigned Addition.

- unsigned binary addition is identical in structure to grade school
decimal addition, except that it uses base 2. The result is a sum bit
and a carry out (carry bit). The carry-out propagates to the next
higher bit positions

down Principle:
- 0 + 0 = 0
- 1 + 0 = 1
- 0 + 1 = 1
- 1 + 1 = (1)0
  ↳ carry bit
- 1 + 1 + 1 = (1)1

#### Page 14

down ex/ What is 7 + 6 in binary (000111 + 000110)

down solution:
                     (1)    (1)
0    0    0    1    1    1
+ 0    0    0    1    1    0
0    0    1    1    0    1

∴ 001101₍bin₎ = 13₍dec₎

2. Unsigned Substraction:
- follows the same positional logic as decimal subtraction

Principle:
1 - 1 = 0
1 - 0 = 1
0 - 0 = 0
0 - 1 = (-1)1
          ↘ borrow bit

down ex/
             (-1)   (-1)
0    1    1    1    0    0    1    1
- 0    0    1    0    0    1    1    0
0    1    0    0    1    1    0    1

3. Unsigned Multiplication:
- is also similar to elementary school . it is implemented as shift and add

down ex/ 10. 5 =
        1 0 1 0
      x   1 0 1
        0 1 0 1 0
        0 0 0 0
      + 1 0 1 0
      1 1 0 0 1 0

4.

#### Page 15

4. Unsigned Division (?)

=> Signed Binary Representations

1. Sign-Magnitude Representation : in this representation, the
most significant bits (MSB) is interpreted solely as a sign indicator.
A value of 0 in MSB denotes a nonnegative number, while a value
of 1 denotes a negative number. The remaining bits represent the
magnitude using ordinary unsigned binary.

N ex/ 000 = +0
     001 = +1
     010 = +2
     011 = +3         with range -(2ⁿ⁻^1 - 1) to +(2ⁿ⁻^1 - 1)
     100 = -0
     101 = -1
     110 = -2
     111 = -3

2. One's complement : In this representation, positive numbers are
represented in ordinary binary, as in the unsigned case. Negative
numbers are formed by taking bitwise complement of the corresponding
positive number, that is, by inverting every bit (if x = 0, x̄ = 1
and if x = 1, x̄ = 0).

N ex/ 000 = +0
     001 = +1
     010 = +2
     011 = +3         with range -(2ⁿ⁻^1 - 1) to +(2ⁿ⁻^1 - 1)
     100 = -3
     101 = -2
     110 = -1
     111 = -3

### Key points

- Unsigned addition in binary works like decimal addition but with base 2.
- Addition produces a sum bit and possibly a carry-out bit.
- Carry propagates to the next higher bit position.
- Unsigned subtraction uses borrowing when a smaller bit subtracts a larger bit.
- Binary multiplication can be implemented as shift and add.
- The arithmetic rules at the bit level underpin ALU design.

### Related topics

- [[unsigned-binary-representation-and-conversion-procedures|Unsigned Binary Representation and Conversion Procedures]]
- [[signed-integer-representations|Signed Integer Representations]]
- [[overflow-underflow-and-language-level-handling|Overflow, Underflow, and Language-Level Handling]]
- [[half-adder-full-adder-and-ripple-carry-addition|Half Adder, Full Adder, and Ripple Carry Addition]]

### Relationships

- depends-on: [[half-adder-full-adder-and-ripple-carry-addition|Half Adder, Full Adder, and Ripple Carry Addition]]
- related: [[overflow-underflow-and-language-level-handling|Overflow, Underflow, and Language-Level Handling]]
