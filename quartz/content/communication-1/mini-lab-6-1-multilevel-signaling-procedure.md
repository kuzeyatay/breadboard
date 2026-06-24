---
title: "Mini-lab 6.1 multilevel signaling procedure"
date: "2026-04-25T10:25:58.869Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "communications-1-coursereader"
source_file: "Communications_1_CourseReader.pdf"
locations: ["Page 73"]
related: ["multilevel-signaling-concept-and-efficiency", "noise-sensitivity-tradeoff-in-multilevel-signaling", "baud-rate-and-bit-rate-relationships"]
tags: ["multilevel-signaling", "bits-per-level", "bpcm", "matlab", "digital-transmitter", "lab-2"]
source_images: ["/communication-1/assets/communications-1-coursereader-page-073-2.png"]
---

## Mini-lab 6.1 multilevel signaling procedure

Source: [[communications-1-coursereader|Communications 1 Course Reader - Sampling, PAM, PCM, and Noise]]

Locations: Page 73

This mini-lab demonstrates multilevel signaling in the MATLAB communication system and links rate and bandwidth concepts to audible receiver performance. Students start by recording one second of voice with $f_s = 40000$ Hz and $n = 16$, then select multilevel signaling in the digital transmitter. After transmission, they inspect the receiver output and compare the parameter $B_{pcm}$ to the values produced by other line codes. The exercise then increases the number of bits per level to 5 and asks whether the recovered audio remains correct. The point is to observe the competing effects of multilevel signaling: higher bits per symbol can reduce required signaling bandwidth for a fixed bit stream, but can also make the transmission less robust because symbol levels are packed more tightly. This mini-lab thus operationalizes the earlier theory about symbol rate, levels, and noise sensitivity.

### Source snapshots

![Communications_1_CourseReader Page 73](/communication-1/assets/communications-1-coursereader-page-073-2.png)

### Page-grounded details

#### Page 73

6.4.1 Bandwidth estimation
We recall the dimensionality theorem from sampling theory, which states that the number
of orthogonal dimensions (independent pieces of information) to describe a signal with
bandwidth B and time period T0 is: ND = 2BT0.
The relation between bandwidth B (in Hz) and symbol rate D=N/T0 (in symbols/s) is
therefore (with N <= ND number of dimensions) :
D = N
T0
<= ND
T0
= 2B (88)
so,
B >= 1
2 D [Hz] (89)
This implies that the minimum bandwidth is half the symbol rate, and this minimum band-
width is achieved when using sinc pulses, where the minimum spacing between pulses is the
time between zeros (so 1/2B).
Minilab exercise 6.1 - Multi-level signaling
This mini-lab exercise requires you to use Mini-lab 3 (the communication system)
on MATLAB.
When you open Minilab 3 you will be confronted with the following view:
In this minilab exercise, multilevel signaling will be demonstrated.
- 1) Start by recording your voice for a second, with configurations of fs = 40000
Hz and n=16. Go to the digital transmitter section, and choose 'Multilevel'
signaling. Leave every other setting as default, and transmit the data.
- 2) Go to the digital receiver, and play the audio,

[Truncated for analysis]

### Key points

- The exercise starts with $f_s = 40000$ Hz and $n = 16$.
- Students select multilevel signaling in the digital transmitter.
- Receiver audio quality is checked after transmission.
- Students compare the value of $B_{pcm}$ with other line codes.
- The number of bits per level is then increased to 5.
- The exercise asks students to explain degraded audio if it occurs.

### Related topics

- [[multilevel-signaling-concept-and-efficiency|Multilevel signaling concept and efficiency]]
- [[noise-sensitivity-tradeoff-in-multilevel-signaling|Noise sensitivity tradeoff in multilevel signaling]]
- [[baud-rate-and-bit-rate-relationships|Baud rate and bit rate relationships]]

### Relationships

- example-of: [[multilevel-signaling-concept-and-efficiency|Multilevel signaling concept and efficiency]]
- example-of: [[noise-sensitivity-tradeoff-in-multilevel-signaling|Noise sensitivity tradeoff in multilevel signaling]]
