---
title: "Two's Complement Arithmetic and Sign Extension"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 16", "Page 17"]
related: ["signed-integer-representations", "overflow-underflow-and-language-level-handling", "unsigned-binary-arithmetic", "half-adder-full-adder-and-ripple-carry-addition"]
tags: ["twos-complement", "negation", "sign-extension", "binary-addition", "subtraction", "carry-out", "fixed-width"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-016.png", "/computer-architecture/assets/computer-architecture-2-page-017.png"]
---

## Two's Complement Arithmetic and Sign Extension

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 16, Page 17

After introducing two's complement as the dominant signed representation, the notes show how arithmetic operations are performed with it. Negation is simple: invert every bit and add 1. The example `00110010` becomes `11001101`, then adding 1 yields `11001110`, the representation of `-50`. Addition in two's complement uses ordinary binary addition because positive values are encoded the same way as unsigned binary. In the worked example, `+5` is `0101`, `-3` is produced from `0011` by inversion and adding 1 to obtain `1101`, and `0101 + 1101 = (1)0010`; the carry out of the MSB is discarded, and the result is correct with no overflow. Subtraction is reduced to addition by negation: `A - B = A + (two's complement of B)`. The notes also introduce sign extension, which preserves the value of a smaller-width two's complement number when loaded into a larger-width storage location. The rule is to replicate the MSB into the added high-order bits. A negative value gets leading ones, while a nonnegative value gets leading zeros.

### Source snapshots

![Computer Architecture-2 Page 16](/computer-architecture/assets/computer-architecture-2-page-016.png)

![Computer Architecture-2 Page 17](/computer-architecture/assets/computer-architecture-2-page-017.png)

### Page-grounded details

#### Page 16

3. Two's complement: Modern systems use this representation
for signed integers (mainly because addition doesn't need any
special logic). This representation modifies one's complement by
adding one to the inverted bit pattern (\hat{x} = \bar{x} + 1),

[downward arrow]
ex/  000 = +0
     001 = +1
     010 = +2
     011 = +3
     100 = -4
     101 = -3
     110 = -2
     111 = -1

with range  -2^(n-1)  to  +(2^(n-1) - 1)
notice that there are no duplicate zeros

[rightward arrow] Converting Two's complement to Decimal: its done similarly
to unsigned representation but the MSB contributes a negative
term

ex/ The pattern 10110 represents
    -1.2^4 + 0.2^3 + 1.2^2 + 1.2^1 + 0.2^0 = -16 + 4 + 2 = -10

[rightward arrow] Two's complement addition
- In two's complement representation, positive numbers are encoded
  exactly the same way as unsigned binary numbers. For this
  reason, ordinary binary addition is used

[rightward arrow] Two's complement subtraction:
Two's complement provides a simple rule for subtraction
Negate the number and add then

A - B = A + (Two's complement of B)

#### Page 17

√ Negation: To form the negative of a number, invert every bit
and add 1.

√ ex/ 50 negated into -50

00110010  } invert
11001101

Add 1 ( + 00000001
        11001110

√ ex/ what is (+5) + (-3) in binary

Solution. 5 in binary is 0101, 3 is 0011

  0011
  1100
+ 0001
  1101

-3 is 1101

then perform
binary addition

   0101
 + 1101
 (1)0010

the leftmost (1) is a carry out of the MSB and discarded. (why?)
(no overflow)

↳ Sign Extension: Processors often load 8 or 16 bit numbers
into 32-bit sized memory slots for operations, when a two's complement
number stored in a smaller width is placed into a larger width, its
value must be preserved. This is done by sign extension, which copies
the MSB into the empty bits. The actual value does not change!

√ ex/

[Left boxed diagram]
11001110

1111111111001110
[the leading 1s are bracketed/underlined to show sign extension]

[Right boxed diagram]
00110010

0000000000110010
[the leading 0s are bracketed/underlined to show sign extension]

### Key points

- Negating a two's complement number means invert all bits and add 1.
- Two's complement addition uses ordinary binary addition hardware.
- Carry out of the MSB is discarded in fixed-width two's complement addition.
- Subtraction is performed as addition of the negated subtrahend.
- Sign extension preserves value when widening a two's complement number.
- Sign extension copies the MSB into the newly added higher-order bits.

### Related topics

- [[signed-integer-representations|Signed Integer Representations]]
- [[overflow-underflow-and-language-level-handling|Overflow, Underflow, and Language-Level Handling]]
- [[unsigned-binary-arithmetic|Unsigned Binary Arithmetic]]
- [[half-adder-full-adder-and-ripple-carry-addition|Half Adder, Full Adder, and Ripple Carry Addition]]

### Relationships

- depends-on: [[overflow-underflow-and-language-level-handling|Overflow, Underflow, and Language-Level Handling]]
