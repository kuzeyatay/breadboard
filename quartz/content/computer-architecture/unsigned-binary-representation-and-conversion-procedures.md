---
title: "Unsigned Binary Representation and Conversion Procedures"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 10", "Page 12", "Page 13"]
related: ["positional-number-systems-and-base-conversion", "why-computers-use-bits-and-how-bit-patterns-gain-meaning", "unsigned-binary-arithmetic", "signed-integer-representations"]
tags: ["unsigned-binary", "msb", "lsb", "binary-to-decimal", "decimal-to-binary", "hexadecimal", "bit-positions"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-010.png", "/computer-architecture/assets/computer-architecture-2-page-012.png"]
---

## Unsigned Binary Representation and Conversion Procedures

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 10, Page 12, Page 13

Unsigned binary is presented as the simplest way to interpret a bit pattern. For an `n`-bit unsigned number, the representable range is `0` to `2^n - 1`, and the value is the weighted sum of the bits: `sum_(i=0)^(n-1) a_i 2^i`. The notes define bit positions explicitly, naming the most significant bit (MSB) at position `n-1` with weight `2^(n-1)` and the least significant bit (LSB) at position `0` with weight `2^0`. Conversion from binary to decimal is done by expanding the pattern according to positional weights, as shown with `10110_2 = 16 + 4 + 2 = 22`. Conversion from decimal to binary is described as repeated division by 2 while recording remainders, then reading the remainders from bottom to top. The worked example converts 4382 into binary and obtains `1000100011110`. The notes also show that hexadecimal maps conveniently to binary in groups of four bits, for example `ABC_16 = 1010 1011 1100`.

### Source snapshots

![Computer Architecture-2 Page 10](/computer-architecture/assets/computer-architecture-2-page-010.png)

![Computer Architecture-2 Page 12](/computer-architecture/assets/computer-architecture-2-page-012.png)

### Page-grounded details

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

#### Page 12

-Bit Positions : Before we begin with different representations, we need
to introduce one simple idea. In any positional representation, not all
bit positions contribute equally. This will become important later on.

[Diagram: a horizontal boxed line labeled with bit indices from left to right `n-1   n-2   ...   1   0`, with `Bit Position` written to the right.]

[Arrow from `n-1` downward-left to label:]
Most significant bit : MSB
(has weight `2^(n-1)`)

[Arrow from `0` downward to label:]
least significant bit : LSB
(has weight `2^0`)

-> Unsigned Binary Representation :
- The simplest interpretation of a bit pattern is the unsigned binary
representation. An n-bit unsigned number can represent values from
0 to `2^n - 1` (all positive). The value of a pattern

`(a_(n-1)  a_(n-2)  ...  a_2  a_1  a_0)_two`

is defined as

`sum_(i=0)^(n-1) a_i . 2^i = a_(n-1)2^(n-1) + a_(n-2)2^(n-2) + ... + a_0 2^0`

[Table/diagram:]

[Above left edge: `MSB` with an upward arrow. Above right edge: `LSB` with an upward arrow.]

Top row: `n-1   n-2   ...   1   0`
Second row: `a_(n-1)   a_(n-2)   ...   a_1   a_0`
Third row: `2^(n-1)   2^(n-2)   ...   2^1   2^0`

[Labels written to the right of the three

[Truncated for analysis]

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

### Key points

- An `n`-bit unsigned number represents values from `0` to `2^n - 1`.
- Unsigned value is computed as `sum a_i 2^i`.
- MSB is the highest-weight bit and LSB is the lowest-weight bit.
- Binary-to-decimal conversion expands a bit pattern by powers of two.
- Decimal-to-binary conversion repeatedly divides by 2 and records remainders.
- Hexadecimal converts easily to binary by replacing each hex digit with 4 bits.

### Related topics

- [[positional-number-systems-and-base-conversion|Positional Number Systems and Base Conversion]]
- [[why-computers-use-bits-and-how-bit-patterns-gain-meaning|Why Computers Use Bits and How Bit Patterns Gain Meaning]]
- [[unsigned-binary-arithmetic|Unsigned Binary Arithmetic]]
- [[signed-integer-representations|Signed Integer Representations]]

### Relationships

- depends-on: [[unsigned-binary-arithmetic|Unsigned Binary Arithmetic]]
- contrasts-with: [[signed-integer-representations|Signed Integer Representations]]
