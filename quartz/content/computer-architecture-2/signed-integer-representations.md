---
title: "Signed Integer Representations"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 15", "Page 16"]
related: ["why-computers-use-bits-and-how-bit-patterns-gain-meaning", "unsigned-binary-representation-and-conversion-procedures", "twos-complement-arithmetic-and-sign-extension", "overflow-underflow-and-language-level-handling"]
tags: ["sign-magnitude", "ones-complement", "twos-complement", "signed-integer", "msb", "range", "negative-numbers"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-015.png", "/computer-architecture/assets/computer-architecture-2-page-016.png"]
---

## Signed Integer Representations

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 15, Page 16

The notes compare three signed binary encodings: sign-magnitude, one's complement, and two's complement. In sign-magnitude, the MSB indicates sign while the remaining bits encode magnitude as an unsigned value. This creates both `+0` and `-0`, and the range is `-(2^(n-1)-1)` to `+(2^(n-1)-1)`. In one's complement, positive numbers are ordinary binary values, and negative numbers are formed by inverting every bit of the corresponding positive number. This also creates duplicate zeros. Two's complement modifies one's complement by adding 1 to the inverted pattern, written as `x_hat = x_bar + 1`. The notes emphasize that modern systems use two's complement mainly because addition does not require special logic separate from ordinary binary addition. Its range is `-2^(n-1)` to `+(2^(n-1)-1)`, and it has no duplicate zeros. The notes also explain how to interpret a two's complement number as decimal: the MSB contributes a negative weight. For example, `10110` equals `-1 x 2^4 + 1 x 2^2 + 1 x 2^1 = -10`.

### Source snapshots

![Computer Architecture-2 Page 15](/computer-architecture/assets/computer-architecture-2-page-015.png)

![Computer Architecture-2 Page 16](/computer-architecture/assets/computer-architecture-2-page-016.png)

### Page-grounded details

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

### Key points

- Sign-magnitude uses the MSB as a sign bit and the remaining bits as magnitude.
- Sign-magnitude has both `+0` and `-0`.
- One's complement forms negative numbers by bitwise inversion.
- One's complement also has duplicate zero representations.
- Two's complement is formed by inverting all bits and adding 1.
- Two's complement has range `-2^(n-1)` to `+(2^(n-1)-1)` and no duplicate zeros.
- Modern systems use two's complement because ordinary binary addition works for signed addition.

### Related topics

- [[why-computers-use-bits-and-how-bit-patterns-gain-meaning|Why Computers Use Bits and How Bit Patterns Gain Meaning]]
- [[unsigned-binary-representation-and-conversion-procedures|Unsigned Binary Representation and Conversion Procedures]]
- [[twos-complement-arithmetic-and-sign-extension|Two's Complement Arithmetic and Sign Extension]]
- [[overflow-underflow-and-language-level-handling|Overflow, Underflow, and Language-Level Handling]]

### Relationships

- depends-on: [[twos-complement-arithmetic-and-sign-extension|Two's Complement Arithmetic and Sign Extension]]
- depends-on: [[overflow-underflow-and-language-level-handling|Overflow, Underflow, and Language-Level Handling]]
