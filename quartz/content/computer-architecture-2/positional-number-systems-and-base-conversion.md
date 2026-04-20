---
title: "Positional Number Systems and Base Conversion"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 9", "Page 10"]
related: ["why-computers-use-bits-and-how-bit-patterns-gain-meaning", "unsigned-binary-representation-and-conversion-procedures", "character-encoding-with-ascii"]
tags: ["positional-number-system", "base-2", "base-8", "base-10", "base-16", "hexadecimal", "binary"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-009.png", "/computer-architecture/assets/computer-architecture-2-page-010.png"]
---

## Positional Number Systems and Base Conversion

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 9, Page 10

The notes begin data representation by separating the idea of number representation from arithmetic itself. Modern number systems are described as positional systems in which the value of a digit depends on both the symbol used and its position in the digit sequence. The general positional rule is given as value contribution equal to digit times base raised to position: `Value_i = C x g^i`. A base-`g` system uses `g` distinct symbols, and the rightmost digit has weight `g^0`, the next `g^1`, and so on. Examples show that the same digit string has different values depending on base: `1320` in base 10 expands to `1 x 10^3 + 3 x 10^2 + 2 x 10^1 + 0 x 10^0`, while `1320` in base 4 and base 5 expand using powers of 4 and 5. The notes list common bases used in computing: binary, octal, decimal, and hexadecimal, with hexadecimal digits `A` through `F` mapped to values 10 through 15. A fixed-width positional system with `n` positions in base `g` represents exactly `g^n` distinct values, which motivates careful attention to bit width.

### Source snapshots

![Computer Architecture-2 Page 9](/computer-architecture/assets/computer-architecture-2-page-009.png)

![Computer Architecture-2 Page 10](/computer-architecture/assets/computer-architecture-2-page-010.png)

### Page-grounded details

#### Page 9

Lecture 2 Week 1

=> Data Representation;
- Before discussing how numbers are added, multiplied, or stored in machines,
one must first understand a more basic question: Why numbers are represented
at all, and how representation works independently of computation

down Counting is one of the earliest human abstractions Long before writing or
mathematics, humans needed ways to represent quantities. Fingers, stones and
marks were used to represent numbers and the choice of a number system
has never been unique.

down Humans settled on what is now called the decimal system (base 10) simply
because we have ten fingers, it made counting and communication natural.
If humans had evolved with 12 fingers, base-12 would likely feel just as
obvious today. For example babylonians used base 60, combining finger
counting with subdivision of finger bones.

- The Positional Number System : Modern number systems share a
common structure called a positional representation. In a positional system
the meaning of a symbol depends on (1) the symbol itself (2) its
position within a sequence.

[Boxed equation]
Value_i = C x g^i

A positional Number System is defined by a base g. The system uses
g distinct

[Truncated for analysis]

#### Page 10

√ 1320 base_4 =
                     1*4^3 +
                     3*4^2 +
                     2*4^1 +
                     0*4^0 = 1*64 + 3*16 + 2*6 4*0 = 120 base_10

√ 1320 base_5 =
                     1*5^3 +
                     3*5^2 +
                     2*5^1 +
                     0*5^0 = 1.125 + 2.25 + 2.5 4.0 = 210 base_5

. We can see that nothing restricts positional systems to base 10. Any
base g >= 2 can be used, what changes is how many symbols are needed and how
Values grow with positions. Some popular bases are:

- g = 2 : Binary numbers eg/1001 (base 2)

- g = 8 : Octal numbers eg/3661 (base 8)

- g = 10 : Decimal numbers eg/1969 (base 10)

- g = 16 : Hexa decimal numbers eg/4BF7 (base 16)
  ↳ A=10, B=11, C=12, D=13, E=14, F=15

. Any real representation System has limits. When representation
uses a fixed number of positions only a finite number of values
can be expressed. With n positions in base g, exactly gⁿ distinct
Values can be represented

√x/ In binary, with four binary positions we can only represent
2^4 = 16 different numbers (distinct patterns that might actually be
interpreted as anything)

[drawn marker/arrow in margin] We can easily go from hexade

[Truncated for analysis]

### Key points

- A positional number system assigns each digit a weight based on its position.
- The contribution of a digit is digit value times base raised to the position.
- The rightmost position has weight `g^0`, then `g^1`, `g^2`, and so on.
- The same digit sequence can represent different values in different bases.
- Common bases listed are 2, 8, 10, and 16.
- Hexadecimal uses symbols `A` to `F` for values 10 to 15.
- With `n` positions in base `g`, exactly `g^n` distinct values are representable.

### Related topics

- [[why-computers-use-bits-and-how-bit-patterns-gain-meaning|Why Computers Use Bits and How Bit Patterns Gain Meaning]]
- [[unsigned-binary-representation-and-conversion-procedures|Unsigned Binary Representation and Conversion Procedures]]
- [[character-encoding-with-ascii|Character Encoding with ASCII]]

### Relationships

- depends-on: [[unsigned-binary-representation-and-conversion-procedures|Unsigned Binary Representation and Conversion Procedures]]
- related: [[why-computers-use-bits-and-how-bit-patterns-gain-meaning|Why Computers Use Bits and How Bit Patterns Gain Meaning]]
