---
title: "Limitations of Parity Bit Checking"
date: "2026-04-25T10:25:58.869Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "communications-1-coursereader"
source_file: "Communications_1_CourseReader.pdf"
locations: ["Page 104", "Page 105"]
related: ["parity-bit-error-detection", "hamming-7-4-coding-and-parity-bit-placement", "hamming-syndrome-based-error-localization"]
tags: ["parity-bit", "error-detection", "crc", "checksums", "usb"]
source_images: ["/communication-1/assets/communications-1-coursereader-page-104-2.png", "/communication-1/assets/communications-1-coursereader-page-105-2.png"]
---

## Limitations of Parity Bit Checking

Source: [[communications-1-coursereader|Communications 1 Course Reader - Sampling, PAM, PCM, and Noise]]

Locations: Page 104, Page 105

The chapter explicitly shows that parity-bit checking can fail when multiple bits change in a way that preserves the expected parity. Because parity summarizes only whether the count of ones is even or odd, it cannot identify which bit changed, and it cannot distinguish a correct sequence from a corrupted one when an even number of bits flip. The example $010001111$ is presented as a case where two bits have flipped relative to the intended transmission, yet the total number of ones remains odd, so a receiver expecting odd parity would accept the message as error-free. The text notes that this incorrect message now corresponds to the letter 'G' rather than the intended 'N', illustrating that parity checking can miss serious corruption. The chapter mentions that parity is still used in simple wired systems such as USB, while more advanced error-detection schemes like cyclic redundancy checks and checksums exist beyond the scope of the course.

### Source snapshots

![Communications_1_CourseReader Page 104](/communication-1/assets/communications-1-coursereader-page-104-2.png)

![Communications_1_CourseReader Page 105](/communication-1/assets/communications-1-coursereader-page-105-2.png)

### Page-grounded details

#### Page 104

9.4.2 Limitations of parity bit error detection
Parity bit checking is a very simple error detection methodology. However, it is also limited,
suppose two bits flip instead of one
010001111 (123)
The number of ones in this message is now 5, which is an odd number. The receiver would
compute this, and would see that it is a odd parity, and would assume that the message
has no errors, however, that message represents the letter 'G' instead of the intended letter
'N', but the error would go undetected. Simple parity bit checking is used in simple wired
communication systems such as USB between two devices. More advanced error detection
schemes are CRC (cyclic redundancy checks), computing checksums, etc. However these
are outside the scope of this course.
100

#### Page 105

Minilab exercise 9.2 - Parity bit checking
This mini-lab exercise requires you to use Mini-lab 5 - Information Theory on MAT-
LAB.
In this exercise, you will experiment with simple parity bit error detection. In the
channel settings, you may choose the number of bits you want to flip so that the
received message contains errors. Furthermore, on the transmitter, you may change
the message (in bits, called the bit stream) and the parity bit type (even or odd ).
On the receiver settings, you may also change the parity bit type, and everytime
you want the system to analyze for errors please click on the 'analyze for errors'
button. Furthermore, for any change made on the transmitter and channel settings,
please always click the send button to resend the data to the receiver.
- 1) Leave default settings, but change the parity bit type on receiver side to
odd parity, and click to analyze errors. Is the error analysis result correct? If
not, explain why
- 2) Keep the settings the same as in the previous question, but now increase
the nr of bits flipped to 1, resend the message, and perform error checking.
Is the error analysis result correct? If not, explain why
- 3) Now change the parity

[Truncated for analysis]

### Key points

- Parity checking can miss errors when an even number of bits flip.
- Parity does not identify which bit is wrong.
- Parity does not correct errors.
- A corrupted message may retain valid parity and pass the check.
- The method is therefore limited for reliable communication.
- More advanced detection methods include CRC and checksums.

### Related topics

- [[parity-bit-error-detection|Parity Bit Error Detection]]
- [[hamming-7-4-coding-and-parity-bit-placement|Hamming(7,4) Coding and Parity-Bit Placement]]
- [[hamming-syndrome-based-error-localization|Hamming Syndrome-Based Error Localization]]

### Relationships

- limits: [[parity-bit-error-detection|Parity Bit Error Detection]]
