---
title: "Hamming(7,4) Coding and Parity-Bit Placement"
date: "2026-04-25T10:25:58.869Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "communications-1-coursereader"
source_file: "Communications_1_CourseReader.pdf"
locations: ["Page 106"]
related: ["parity-bit-error-detection", "hamming-syndrome-based-error-localization", "limitations-of-parity-bit-checking"]
tags: ["hamming-codes", "hamming-7-4", "parity-bits", "error-correction", "even-parity", "final-topic"]
source_images: ["/communication-1/assets/communications-1-coursereader-page-106-2.png"]
---

## Hamming(7,4) Coding and Parity-Bit Placement

Source: [[communications-1-coursereader|Communications 1 Course Reader - Sampling, PAM, PCM, and Noise]]

Locations: Page 106

Hamming codes are introduced as a method for both error detection and single-error correction. If a message has length $m$, then $k$ parity bits are added so the transmitted block length becomes $n = m + k$. The worked example uses a 4-bit message and three parity bits, yielding the Hamming(7,4) code. The parity bits are placed at positions that are powers of two: 1, 2, and 4 in the 7-bit block. The remaining positions carry the data bits. For the message 1010, the arrangement is $p_1\ p_2\ x_3\ p_3\ x_2\ x_1\ x_0$, which becomes $p_1\ p_2\ 1\ p_3\ 0\ 1\ 0$. Each parity bit covers a specific subset of positions: $p_1$ checks 1, 3, 5, 7; $p_2$ checks 2, 3, 6, 7; and $p_3$ checks 4, 5, 6, 7. Using even parity, the example produces $p_1=1$, $p_2=0$, and $p_3=1$, so the final coded word is 1011010. This construction is a reusable coding procedure and extends the parity idea into a structured correction code.

### Source snapshots

![Communications_1_CourseReader Page 106](/communication-1/assets/communications-1-coursereader-page-106-2.png)

### Page-grounded details

#### Page 106

9.4.3 Hamming codes - (Error correction and detection)
Hamming codes are a method for both detecting and correcting errors in a transmitted
message. Suppose we want to send a binary message of length m. To ensure error detection
and correction, we add k parity bits, where the total number of bits in the transmitted
sequence becomes n = m + k. These parity bits are positioned strategically to allow the
detection and precise correction of errors in the message.
For example, let's consider we want to transmit the message 1010. We will add three
parity bits to this message, resulting in a total of seven bits. This setup is known as the
Hamming(7,4) code, where n = 7, m = 4, and k = 3.
In Hamming codes, the parity bits are placed at positions that are powers of 2: 1, 2, 4, 8,
and so on. In our 7-bit Hamming coded message, the bits are arranged as follows:
1 2 3 4 5 6 7
p1 p2 x3 p3 x2 x1 x0
Here, pn represents the n-th parity bit, and xn represents the n-th data bit. If we substitute
the data bits with our message (1010), we obtain:
1 2 3 4 5 6 7
p1 p2 1 p3 0 1 0
Next, we compute the parity bits one by one.
1. First Parity Bit (p1): The first parity bit p1 checks the bits at positions 1,

[Truncated for analysis]

### Key points

- Hamming codes add parity bits for detection and correction.
- The total block length is $n = m + k$.
- In Hamming(7,4), $m=4$, $k=3$, and $n=7$.
- Parity bits are placed at powers-of-two positions: 1, 2, 4, 8, ...
- For the 7-bit case, the layout is $p_1\ p_2\ x_3\ p_3\ x_2\ x_1\ x_0$.
- Parity subsets are chosen so each bit position has a unique parity pattern.
- The example message 1010 encodes to 1011010.

### Related topics

- [[parity-bit-error-detection|Parity Bit Error Detection]]
- [[hamming-syndrome-based-error-localization|Hamming Syndrome-Based Error Localization]]
- [[limitations-of-parity-bit-checking|Limitations of Parity Bit Checking]]

### Relationships

- derives-from: [[parity-bit-error-detection|Parity Bit Error Detection]]
