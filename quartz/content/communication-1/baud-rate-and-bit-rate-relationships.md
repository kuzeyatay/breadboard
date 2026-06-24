---
title: "Baud rate and bit rate relationships"
date: "2026-04-25T10:25:58.869Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "communications-1-coursereader"
source_file: "Communications_1_CourseReader.pdf"
locations: ["Page 72"]
related: ["multilevel-signaling-concept-and-efficiency", "bandwidth-estimation-from-dimensionality-theorem", "bits-per-sample-versus-bits-per-level"]
tags: ["baud-rate", "symbol-rate", "bit-rate", "multilevel-signaling", "levels"]
source_images: ["/communication-1/assets/communications-1-coursereader-page-072-2.png"]
---

## Baud rate and bit rate relationships

Source: [[communications-1-coursereader|Communications 1 Course Reader - Sampling, PAM, PCM, and Noise]]

Locations: Page 72

The chapter defines symbol rate, or baud rate, as the number of symbols transmitted per second. A symbol represents one or more bits depending on the number of levels used. The general definition is $D = N/T_0$, where $N$ is the number of dimensions and $T_0$ is the allocated time of a dimension. The key point is that symbol rate is not generally equal to bit rate. In multilevel signaling, one symbol can encode $l$ bits, so the bit rate is $R = lD = D\log_2(L) = (N/T_0)\log_2(L)$. For binary signaling, where $L = 2$ and $l = 1$, bit rate equals symbol rate. The text uses a figure with $l = 3$ to illustrate that symbols occupy intervals of time while each symbol carries three bits. This framework is central to all subsequent bandwidth and line coding analysis because the physical channel constrains symbol rate, while the information source constrains bit rate.

### Source snapshots

![Communications_1_CourseReader Page 72](/communication-1/assets/communications-1-coursereader-page-072-2.png)

### Page-grounded details

#### Page 72

6.4 Baud (or Symbol) rate
Symbol rate D refers to the number of signal changes (or symbols) per second in a commu-
nication channel. Each symbol in a transmission represents a specific number of bits l, and
the baud determines how many symbols can be transmitted per unit of time. Symbol rate
is equal to
D = N
T0
(86)
where N is the number of dimensions and T0 is the allocated time of a dimension.
It is important to note that the symbol rate is not necessarily equal to the number of bits
per second R, as one symbol can represent multiple bits, as shown in multilevel signaling
(see Fig. 51 for visualization). Thus, the relationship between them can be denoted as




R = lD = D log2(L) = N
T0 log2(L) = n
T0 [bits/s] 	(87)
e.g. for binary signaling (so where we only have two levels to represent 0 or 1), L = 2, hence
l = log2(2) = 1, which means R = D.
010 	101 	000 	100 	100
Time [s]
Voltage [V]
Symbol
duration
Symbol 1 	Symbol 2 	Symbol 3 	Symbol 4 	Symbol 5
0
Figure 51: Multilevel transmission with l = 3. The figure illustrates the difference between symbol
rate and bit rate
68

### Key points

- Symbol rate $D$ is the number of symbols per second.
- The chapter defines $D = N/T_0$.
- Bit rate and symbol rate are equal only when one symbol carries one bit.
- In general, $R = lD = D\log_2(L)$.
- Binary signaling has $L = 2$, so $l = 1$ and therefore $R = D$.
- Multilevel signaling increases bit rate without requiring the same increase in symbol rate.

### Related topics

- [[multilevel-signaling-concept-and-efficiency|Multilevel signaling concept and efficiency]]
- [[bandwidth-estimation-from-dimensionality-theorem|Bandwidth estimation from dimensionality theorem]]
- [[bits-per-sample-versus-bits-per-level|Bits per sample versus bits per level]]

### Relationships

- depends-on: [[bandwidth-estimation-from-dimensionality-theorem|Bandwidth estimation from dimensionality theorem]]
