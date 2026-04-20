---
title: "Character Encoding with ASCII"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 19"]
related: ["why-computers-use-bits-and-how-bit-patterns-gain-meaning", "positional-number-systems-and-base-conversion", "software-layers-operating-system-compiler-and-isa"]
tags: ["ascii", "character-encoding", "byte", "string", "bit-pattern", "textual-information"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-019.png"]
---

## Character Encoding with ASCII

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 19

The notes extend the idea of bit-pattern interpretation from numbers to text. Computers fundamentally store only binary patterns, so textual data must be represented by assigning a numerical code to each character. This allows letters, digits, punctuation, and control symbols to be stored and manipulated in memory just like numeric data. The notes describe a common one-byte-per-character approach, which allows up to 256 distinct values. A string is therefore represented as a sequence of bytes, with each byte corresponding to one encoded character. The primary named example is ASCII, the American Standard Code for Information Interchange, identified as the most commonly used one-byte encoding in the notes. Although the chunk does not provide the full ASCII table, it establishes the durable principle that character data is an interpretation layer built on top of bit patterns, exactly like integer representations. This topic links directly back to the earlier claim that bit patterns have meaning only under an interpretation scheme.

### Source snapshots

![Computer Architecture-2 Page 19](/computer-architecture/assets/computer-architecture-2-page-019.png)

### Page-grounded details

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

- Text can be represented by assigning numeric codes to characters.
- Computers store textual information as bit patterns just as they store numbers.
- One byte per character allows up to 256 distinct encoded values.
- A string is a sequence of bytes corresponding to characters.
- ASCII is named as a common one-byte character encoding.

### Related topics

- [[why-computers-use-bits-and-how-bit-patterns-gain-meaning|Why Computers Use Bits and How Bit Patterns Gain Meaning]]
- [[positional-number-systems-and-base-conversion|Positional Number Systems and Base Conversion]]
- [[software-layers-operating-system-compiler-and-isa|Software Layers, Operating System, Compiler, and ISA]]

