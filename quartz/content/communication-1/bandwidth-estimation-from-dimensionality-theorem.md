---
title: "Bandwidth estimation from dimensionality theorem"
date: "2026-04-25T10:25:58.869Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "communications-1-coursereader"
source_file: "Communications_1_CourseReader.pdf"
locations: ["Page 73"]
related: ["baud-rate-and-bit-rate-relationships", "nyquist-zero-isi-criterion-and-ideal-sinc-pulses", "raised-cosine-nyquist-filtering"]
tags: ["bandwidth", "symbol-rate", "dimensionality-theorem", "sinc-pulses", "nyquist", "lab-2"]
source_images: ["/communication-1/assets/communications-1-coursereader-page-073-2.png"]
---

## Bandwidth estimation from dimensionality theorem

Source: [[communications-1-coursereader|Communications 1 Course Reader - Sampling, PAM, PCM, and Noise]]

Locations: Page 73

The text connects symbol transmission to physical bandwidth through the dimensionality theorem from sampling theory. A signal of bandwidth $B$ observed over time period $T_0$ has at most $N_D = 2BT_0$ orthogonal dimensions. Since the communication system can use at most $N \leq N_D$ dimensions, the symbol rate satisfies $D = N/T_0 \leq N_D/T_0 = 2B$. Rearranging gives the lower bound $B \geq D/2$. This is a key result: the minimum bandwidth needed for a given symbol rate is half the symbol rate. The text states that this lower bound is achieved by sinc pulses, whose minimum spacing equals the time between zero crossings, $1/(2B)$. This result underpins the later development of Nyquist zero-ISI pulses and raised-cosine filtering. It also explains why increasing bits per symbol can lower required bandwidth for a fixed bit rate: if $R = lD$, then raising $l$ allows a smaller $D$, which in turn allows a smaller $B$.

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

- The dimensionality theorem gives $N_D = 2BT_0$.
- Symbol rate satisfies $D = N/T_0 \leq 2B$.
- Therefore the minimum required bandwidth obeys $B \geq D/2$.
- The minimum bandwidth is achieved with sinc pulses.
- Bandwidth limits symbol rate directly and bit rate indirectly through $R = lD$.

### Related topics

- [[baud-rate-and-bit-rate-relationships|Baud rate and bit rate relationships]]
- [[nyquist-zero-isi-criterion-and-ideal-sinc-pulses|Nyquist zero-ISI criterion and ideal sinc pulses]]
- [[raised-cosine-nyquist-filtering|Raised-cosine Nyquist filtering]]

### Relationships

- depends-on: [[nyquist-zero-isi-criterion-and-ideal-sinc-pulses|Nyquist zero-ISI criterion and ideal sinc pulses]]
