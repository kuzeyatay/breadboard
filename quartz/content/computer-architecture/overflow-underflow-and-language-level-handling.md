---
title: "Overflow, Underflow, and Language-Level Handling"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 18", "Page 19"]
related: ["signed-integer-representations", "twos-complement-arithmetic-and-sign-extension", "unsigned-binary-arithmetic", "character-encoding-with-ascii"]
tags: ["overflow", "underflow", "unsigned-binary", "twos-complement", "ada", "python"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-018.png", "/computer-architecture/assets/computer-architecture-2-page-019.png"]
---

## Overflow, Underflow, and Language-Level Handling

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 18, Page 19

The notes distinguish overflow and underflow as consequences of finite-width representations. Overflow occurs when the exact result of an arithmetic operation requires more bits than the register provides, so the stored result must be truncated. In unsigned arithmetic, overflow in addition appears as a carry that goes beyond the available bit space, and underflow in subtraction occurs when the result would be negative even though unsigned numbers cannot represent negative values. For two's complement, overflow is detected by the sign pattern rather than by the final carry. There is no overflow when adding a positive and a negative number, or when subtracting numbers with the same sign. Overflow occurs when adding two positive numbers gives a negative result, or adding two negative numbers gives a positive result. The notes then discuss software-level handling differences across languages: C may ignore hardware overflow for unsigned integers and simply discard hanging carry or borrow bits, Ada and Fortran may raise runtime exceptions, and Python may avoid overflow by switching to larger integer representations automatically.

### Source snapshots

![Computer Architecture-2 Page 18](/computer-architecture/assets/computer-architecture-2-page-018.png)

![Computer Architecture-2 Page 19](/computer-architecture/assets/computer-architecture-2-page-019.png)

### Page-grounded details

#### Page 18

=> Overflow

- Overflow occurs when the exact mathematical result of an arithmetic operation requires more bits than the fixed number available to store it. Digital Systems operate with registers of fixed width, such as 8,16,32 or 64 bits, any result that cannot be represented within that width must be truncated.

└> Over flow in unsigned binary :
- case (1) During addition : carry bit goes beyond the available bit space
ex/  1 1 0 1
   + 0 1 1 1
   1 0 1 0 0

- case (2) During subtraction : borrow bit goes beyond the bit spe
down ex/ (-1 1)
   0 0 0 1
 - 0 0 1 0
 (1) 1 1 1 1

└> Overflow in two's complement :
- case (1) adding/subtracting binaries results in overflow
But:

▼ No overflow when adding a positive number to a negative
number (or subtracting two numbers with the same sign)
ex/  0 1 1 1
   + 1 0 0 1
 (1) 0 0 0 0
   -> (1) is omitted

└> It occurs when the sign of the result is inconsistent if

└> Case (1) Adding two positive numbers provides a negative
result
ex/  0 1 1 1
   + 0 0 0 1
   1 0 0 0

└> Case (2) Adding two negative numbers provides a positive
result
ex/  1 1 1 1
   + 1 0 0 1
 (1) 0 0 0 0

#### Page 19

↳ Dealing with overflow : Different programming languages nd systems
handle overflow in different ways.

down Some languages suc as C ignore overflow at the hardware level for
unsigned integers. The "hanging" carry/borrow bits are deleted.
To mitigate this, systems may employ overflow detection

! other languages, such as Ada and Fortran simply treat overflow
as a runtime exception and stops the program if it occurs

down Higher level languages such as Python avoid overflow entirely by
automatically switching to a larger integer representation
when needed


=> Representing Characters with Numbers
. So far, binary representations have been used to encode numerical values.
The same idea can be extended to represent textual information, such as
letters digits, punctuation, control symbols. Since computers oly store
bit patterns, by assigning each character a numerical code, we can store
textual information.

down A camon approach is to use one byte (8 bits) per character, allowing
up to 256 distinct values (A string is therefore a seqence of bytes, corresponding
to one character). The mostly used one byte encoding is ASCII (American
standard code for information interchange). Check it

[Truncated for analysis]

### Key points

- Overflow means the exact result needs more bits than the fixed register width provides.
- Unsigned addition overflow is indicated by a carry beyond the available width.
- Unsigned subtraction underflow occurs when the result is below zero.
- In two's complement, sign inconsistency reveals overflow.
- Adding operands of opposite sign does not cause two's complement overflow.
- Language behavior differs: discard, trap, or enlarge representation.

### Related topics

- [[signed-integer-representations|Signed Integer Representations]]
- [[twos-complement-arithmetic-and-sign-extension|Two's Complement Arithmetic and Sign Extension]]
- [[unsigned-binary-arithmetic|Unsigned Binary Arithmetic]]
- [[character-encoding-with-ascii|Character Encoding with ASCII]]

