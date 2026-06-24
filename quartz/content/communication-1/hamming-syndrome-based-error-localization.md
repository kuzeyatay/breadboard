---
title: "Hamming Syndrome-Based Error Localization"
date: "2026-04-25T10:25:58.869Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "communications-1-coursereader"
source_file: "Communications_1_CourseReader.pdf"
locations: ["Page 107", "Page 108"]
related: ["hamming-7-4-coding-and-parity-bit-placement", "limitations-of-parity-bit-checking", "information-theory-motivation-and-error-control-need"]
tags: ["hamming-codes", "hamming-7-4", "xor", "syndrome", "error-correction"]
source_images: ["/communication-1/assets/communications-1-coursereader-page-107-2.png", "/communication-1/assets/communications-1-coursereader-page-108-2.png"]
---

## Hamming Syndrome-Based Error Localization

Source: [[communications-1-coursereader|Communications 1 Course Reader - Sampling, PAM, PCM, and Noise]]

Locations: Page 107, Page 108

After transmission, Hamming-coded data can be checked by recomputing the parity structure and comparing it with the received block. The chapter explains this with a received word that differs from the transmitted Hamming(7,4) code in a single bit. Starting from the correct codeword 1011010, a flipped last bit produces 1011011. The receiver extracts the data bits from positions 3, 5, 6, and 7, yielding 1011, and recomputes the corresponding Hamming code as 0110011. An XOR between the received sequence and the recomputed sequence yields 1101000. The key insight is that the parity-bit locations where the XOR result is 1 encode the binary index of the erroneous bit. In this example, the pattern identifies position 7, matching the flipped bit. If no error occurred, the recomputed and received sequences would match and the XOR result would be all zeros. The section also notes an important limitation: Hamming codes can correct only a single flipped bit in a block, although they can detect some multiple-bit errors better than a simple parity check.

### Source snapshots

![Communications_1_CourseReader Page 107](/communication-1/assets/communications-1-coursereader-page-107-2.png)

![Communications_1_CourseReader Page 108](/communication-1/assets/communications-1-coursereader-page-108-2.png)

### Page-grounded details

#### Page 107

Once the receiver receives a message, they compute the parity bits for the received sequence,
and compare them with the received parity bits. If any discrepancy is found, an error is
detected.
Suppose one bit of the transmitted message flips, turning 1011010 into:
1011011 (125)
The receiver takes the message from the bits in positions 3, 5, 6, and 7, which are:
1011 (126)
It computes the parity bits for this sequence, resulting in:
0110011 (127)
Next, it performs an XOR operation between the received sequence and the computed
sequence:
1011011 ⊕ 0110011 = 1101000 (128)
The result of the XOR operation reveals the position of the flipped bit, as the bits at
the parity bit locations that are set to 1 correspond to the binary representation of the
error position. In this case, the error occurs at bit position 7, which is where the flip
happened.
If no error occurs, the received and computed sequences will match exactly, and their XOR
will result in a sequence of all 0s, indicating no error.
Pitfalls of hamming codes
While hamming codes excel at correcting a single flipped bit within a sequence block, they
fall short when faced with multiple flipped bits. Despite this limitation, hammin

[Truncated for analysis]

#### Page 108

In this exercise, we will explore hamming(7,4) codes. On the transmitter settings,
you may write the message you want to transmit. On the channel settings, you
may choose the number of bits to flip, and on the receiver side, you will see how
the message was received and how it transformed after hamming error correction
was performed. Moreover, on the bottom left, you may see the total number of
bits of the transmitted sequence and only the number of bits of the message.
- 1) Change the number of bits flipped to 1, and re-transmit the message, to
observe the effects of error correction.
- 2) Increase the number of bits flipped to 3, and re-transmit the message. Is
the message correctly shown to the receiver? If so, can you explain how is
this possible when in theory, hamming code sequences can correct only one
bit flip?
- 3) Now keep increasing the number of bit's flipped and re-transmit the mes-
sage. Is it possible to correctly decode the message after a lot of bit flips
have occurred?
104

### Key points

- The receiver recomputes parity information from the received data.
- A mismatch between computed and received parity indicates an error.
- The error position is identified by the parity mismatch pattern.
- The chapter demonstrates error localization using an XOR operation.
- If no error occurs, the syndrome is all zeros.
- Hamming codes correct single-bit errors but not arbitrary multiple-bit errors.
- They still detect multiple errors better than simple parity checking.

### Related topics

- [[hamming-7-4-coding-and-parity-bit-placement|Hamming(7,4) Coding and Parity-Bit Placement]]
- [[limitations-of-parity-bit-checking|Limitations of Parity Bit Checking]]
- [[information-theory-motivation-and-error-control-need|Information Theory Motivation and Error Control Need]]

### Relationships

- depends-on: [[hamming-7-4-coding-and-parity-bit-placement|Hamming(7,4) Coding and Parity-Bit Placement]]
- contrasts-with: [[limitations-of-parity-bit-checking|Limitations of Parity Bit Checking]]
