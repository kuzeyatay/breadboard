---
title: "Information Theory Motivation and Error Control Need"
date: "2026-04-25T10:25:58.869Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "communications-1-coursereader"
source_file: "Communications_1_CourseReader.pdf"
locations: ["Page 100", "Page 103"]
related: ["shannon-hartley-channel-capacity-theorem", "parity-bit-error-detection", "hamming-7-4-coding-and-parity-bit-placement"]
tags: ["information-theory", "bit-error-probability", "noise", "error-detection", "error-correction"]
source_images: ["/communication-1/assets/communications-1-coursereader-page-100-2.png", "/communication-1/assets/communications-1-coursereader-page-103-2.png"]
---

## Information Theory Motivation and Error Control Need

Source: [[communications-1-coursereader|Communications 1 Course Reader - Sampling, PAM, PCM, and Noise]]

Locations: Page 100, Page 103

The information theory chapter motivates both capacity analysis and coding methods by starting from a practical observation: channels corrupt data with noise, so the probability of a bit error is generally nonzero. The material gives a concrete example in which a bit error probability of $P_e = 10^{-6}$, typical in wireless systems, combined with a 1 Mbps data rate causes about one bit flip per second. That motivates two core questions: how much information can be sent reliably through a noisy channel, and how can the receiver detect or fix corrupted bits? The chapter therefore pairs the Shannon capacity theorem with error detection and correction mechanisms. Figures 73 and 74 present these as part of a topic map linking physical channels, raised-cosine filtering, intersymbol interference, noise, Shannon's theorem, and error detection/correction. The material also stresses that such error-control schemes are used almost everywhere in digital communications and storage systems.

### Source snapshots

![Communications_1_CourseReader Page 100](/communication-1/assets/communications-1-coursereader-page-100-2.png)

![Communications_1_CourseReader Page 103](/communication-1/assets/communications-1-coursereader-page-103-2.png)

### Page-grounded details

#### Page 100

9 Information theory
9.1 Learning objectives
Students completing this chapter should have learned:
1. Understand the fundamental limit for channel capacity based on the Shannon-Hartley
Theorem.
2. Can calculate the maximum theoretical capacity of a channel based on the bandwidth
and the SNR.
3. Understand the difference between power limited and bandwidth limited modes of
operation for a communication channel.
4. Can calculate a parity bit for a simple case of digital word transmission.
5. Understands the concept of Hamming distance and can use Hamming(7,4) coding to
detect and correct single bit errors.
9.2 Motivation
This section first introduces a maximum theoretical upper bound on the total amount of
information (in bits) that can be sent reliably through a channel, given the bandwidth
and SNR. This upper bound is known as Shannon-Hartley capacity theorem, and is a very
important theorem in the field of digital communications. As we have observed, nearly every
signal, when transmitted through a channel, undergoes corruption from noise, resulting in
a probability of error (or bit flip) greater than zero. If the chance that the incoming digital
data will contain a bit of flip due

[Truncated for analysis]

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

- Noise makes bit errors unavoidable in practical channels.
- A typical wireless bit error probability is given as $P_e = 10^{-6}$.
- At 1 Mbps and $P_e = 10^{-6}$, about one bit flips each second.
- Information theory studies both reliable transmission limits and error handling.
- Error detection and correction are presented as core digital communication tools.
- The chapter connects physical channel impairments with coding methods.

### Related topics

- [[shannon-hartley-channel-capacity-theorem|Shannon-Hartley Channel Capacity Theorem]]
- [[parity-bit-error-detection|Parity Bit Error Detection]]
- [[hamming-7-4-coding-and-parity-bit-placement|Hamming(7,4) Coding and Parity-Bit Placement]]

### Relationships

- related: [[shannon-hartley-channel-capacity-theorem|Shannon-Hartley Channel Capacity Theorem]]
