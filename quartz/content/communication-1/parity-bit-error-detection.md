---
title: "Parity Bit Error Detection"
date: "2026-04-25T10:25:58.869Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "communications-1-coursereader"
source_file: "Communications_1_CourseReader.pdf"
locations: ["Page 103"]
related: ["limitations-of-parity-bit-checking", "hamming-7-4-coding-and-parity-bit-placement", "information-theory-motivation-and-error-control-need"]
tags: ["parity-bit", "odd-parity", "even-parity", "error-detection", "bitflip"]
source_images: ["/communication-1/assets/communications-1-coursereader-page-103-2.png"]
---

## Parity Bit Error Detection

Source: [[communications-1-coursereader|Communications 1 Course Reader - Sampling, PAM, PCM, and Noise]]

Locations: Page 103

Parity-bit checking is introduced as a simple method for error detection in digital communication and storage. A parity bit is appended to a binary message so that the total number of ones becomes either even or odd, depending on a prearranged parity convention. The sender and receiver must agree on odd parity or even parity in advance. The chapter uses the binary representation of the letter 'N' as a worked example. For the message $01001110$, which contains four ones, odd parity requires appending a 1 to make the total number of ones equal to five, yielding $010011101$. At the receiver, if the corresponding received message has an incorrect parity count, an error is detected. The method is attractive because it is easy to implement, but it only detects certain error patterns. The text frames parity bits as a foundation for understanding more advanced coding methods and as a practical mechanism for identifying faulty data so it can be discarded or retransmitted.

### Source snapshots

![Communications_1_CourseReader Page 103](/communication-1/assets/communications-1-coursereader-page-103-2.png)

### Page-grounded details

#### Page 103

9.4 Error detection and correction schemes
Error detection and correction are crucial in digital communications, especially when us-
ing channels like wireless ones where errors (such as bitflips) due to noise are common
(why would they be more common in wireless communication compared to wired communi-
cation? ).
Being able to detect if and when bits have been received with an error will allow us to
discard wrong data and not use it for further processing. In this information theory section,
we will explore a simple error detection method called parity bit checking. Having a good
error detection scheme, will allow us to find faulty messages and retry to send the data
across the channel and hope that no errors occur this time. This can be very expensive
and does not allow for high data transmission rates which we need for most applications. It
can also severely congest the network and cause many other undesirable effects (The exact
impact of packet re-transmission is not included in this course).
A better way would be if we could somehow create self-correcting data, which gets self-
corrected at the receiver, such that we do not have to resend it again. Using the principles
of pari

[Truncated for analysis]

### Key points

- A parity bit is added so the total number of ones is either even or odd.
- Sender and receiver must agree on odd parity or even parity.
- Parity checking detects a mismatch between expected and received parity.
- The example message $01001110$ represents the letter 'N' in binary.
- Under odd parity, $01001110$ becomes $010011101$.
- Parity checking is an error-detection method, not an error-correction method.
- The method is used in communication systems and data storage.

### Related topics

- [[limitations-of-parity-bit-checking|Limitations of Parity Bit Checking]]
- [[hamming-7-4-coding-and-parity-bit-placement|Hamming(7,4) Coding and Parity-Bit Placement]]
- [[information-theory-motivation-and-error-control-need|Information Theory Motivation and Error Control Need]]

### Relationships

- applies-to: [[information-theory-motivation-and-error-control-need|Information Theory Motivation and Error Control Need]]
