---
title: "Why Computers Use Bits and How Bit Patterns Gain Meaning"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 10", "Page 11"]
related: ["positional-number-systems-and-base-conversion", "unsigned-binary-representation-and-conversion-procedures", "signed-integer-representations", "character-encoding-with-ascii"]
tags: ["bit", "bit-pattern", "binary-system", "nibble", "byte", "unsigned-representation", "signed-representation"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-010.png", "/computer-architecture/assets/computer-architecture-2-page-011.png"]
---

## Why Computers Use Bits and How Bit Patterns Gain Meaning

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 10, Page 11

The notes motivate binary representation from physical engineering constraints rather than from mathematics alone. Computers store information as physical states such as voltages in transistors and wires, but these states are imperfect because of noise, temperature changes, and manufacturing variation. Distinguishing only two states, low and high, is much more reliable than trying to distinguish many finely spaced levels such as ten decimal levels. This is why computers use binary. A single two-state quantity is a bit, and bits are grouped into fixed-size patterns such as 4-bit nibbles, 8-bit bytes, 16-bit groups, and 32-bit groups. The machine can copy and transform bit patterns without knowing what they mean; meaning arises only when software or hardware interprets the pattern under a representation scheme. The same pattern may represent an unsigned integer, a signed integer, a character, or something else. This interpretive idea is foundational because it explains why later sections can discuss unsigned numbers, sign-magnitude, one's complement, two's complement, and ASCII all using the same underlying stored bits.

### Source snapshots

![Computer Architecture-2 Page 10](/computer-architecture/assets/computer-architecture-2-page-010.png)

![Computer Architecture-2 Page 11](/computer-architecture/assets/computer-architecture-2-page-011.png)

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

#### Page 11

-> Why Computers use Bits, and how arithmetic depends on representation

- A computer is a physical machine. It stores information in physical
states such as voltage levels in transistors and wires. Physical states
are never perfectly stable and can be affected by temperature changes, noise,
manufacturing variations etc. If we tried to build a machine that
reliably distinguishes among ten voltage levels (like decimal digits), tiny
errors would constantly cause one level to be mistaken for the next.
The engineering trick is to choose two states that are far apart: "low"
and "high" so that even with noise, the machine can still tell them apart,
Hence why we use the binary system in computers.

down A single two state quantity is called a bit (analogous to digit). Hardware
stores bits in fixed-size groups; that sometimes have special names

1            | 1 bit
1010         | 4 bits = "nibble"
10000001     | 8 bits = byte
1111111111001110 | 16 bits
10101001010010111110100100111110 | 32 bits

↳ A fixed size group is called a bit pattern. With n bits, there are 2ⁿ
possible patterns. The machine can move, copy and transform these patterns
perfectly well without knowing what they "mean"

[Truncated for analysis]

### Key points

- Binary is used because two well-separated physical states are more reliable than many closely spaced states.
- A bit is a single two-state quantity.
- Bits are stored in fixed-size groups such as nibbles and bytes.
- With `n` bits there are `2^n` possible bit patterns.
- Bit patterns have no inherent meaning until interpreted.
- The same bit pattern can represent unsigned values, signed values, characters, or other data.

### Related topics

- [[positional-number-systems-and-base-conversion|Positional Number Systems and Base Conversion]]
- [[unsigned-binary-representation-and-conversion-procedures|Unsigned Binary Representation and Conversion Procedures]]
- [[signed-integer-representations|Signed Integer Representations]]
- [[character-encoding-with-ascii|Character Encoding with ASCII]]

### Relationships

- depends-on: [[unsigned-binary-representation-and-conversion-procedures|Unsigned Binary Representation and Conversion Procedures]]
- depends-on: [[signed-integer-representations|Signed Integer Representations]]
- depends-on: [[character-encoding-with-ascii|Character Encoding with ASCII]]
