---
title: "Multilevel signaling concept and efficiency"
date: "2026-04-25T10:25:58.869Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "communications-1-coursereader"
source_file: "Communications_1_CourseReader.pdf"
locations: ["Page 68", "Page 69"]
related: ["baud-rate-and-bit-rate-relationships", "noise-sensitivity-tradeoff-in-multilevel-signaling", "bits-per-sample-versus-bits-per-level"]
tags: ["multilevel-signaling", "symbol", "levels", "polar-nrz", "bits-per-level", "bandwidth"]
source_images: ["/communication-1/assets/communications-1-coursereader-page-068-2.png", "/communication-1/assets/communications-1-coursereader-page-069-2.png"]
---

## Multilevel signaling concept and efficiency

Source: [[communications-1-coursereader|Communications 1 Course Reader - Sampling, PAM, PCM, and Noise]]

Locations: Page 68, Page 69

Multilevel signaling groups multiple input bits into one transmitted symbol by assigning each bit pattern to a distinct signal level. Instead of sending bits one by one, a transmitter can send pairs or larger groups of bits using more than two amplitude levels. For example, a two-bit symbol can map $00$, $01$, $10$, and $11$ to four different voltages. This increases transmission efficiency because each symbol carries more information. If the symbol duration is unchanged, the same information can be delivered in less time; equivalently, for a fixed information rate, fewer symbol transitions are needed and the required bandwidth can be reduced. The text formalizes this by defining $l$ as the number of bits per level and $L$ as the number of levels, related by $L = 2^l$ and $l = \log_2 L$. The chapter emphasizes that multilevel signaling is fundamental in practical digital communication systems, but its benefits come with greater sensitivity to channel noise because adjacent decision levels are closer together.

### Source snapshots

![Communications_1_CourseReader Page 68](/communication-1/assets/communications-1-coursereader-page-068-2.png)

![Communications_1_CourseReader Page 69](/communication-1/assets/communications-1-coursereader-page-069-2.png)

### Page-grounded details

#### Page 68

6 Digital signaling
6.1 Learning objectives
Students completing this chapter should have learned:
1. Can calculate bit rate, baudrate and bandwidth for any given set of initial parameters.
2. Understand the difference between bits per sample and bits per symbol. Understand
the limitations of multi-level modulation.
6.2 Motivation
In the previous section (digitization) we saw how an analog signal is converted into a digital
binary stream (PCM). We also analyzed the bandwidth of PCM signals, and we saw that
there is a dependence of the PCM signals based on the digital waveform we use (such as
Polar NRZ, Unipolar NRZ etc.). In this section, we will see a vectorial representation of
digital signaling, the concepts of multilevel signaling (which is used in every practical digital
communications system), and the concept of symbol rate.
PCM Signaling
(Line coding)
101011010
1 0 1 0 1 1 0 1 0
Figure 47: Digital signaling and line coding - Topic map location
6.3 Multi-level signaling
Now, to further understand the fundamentals of digital data transmission, we must under-
stand how we prepare and transmit this information. These are the steps taken we have
covered so far:
- Via our ADC, we c

[Truncated for analysis]

#### Page 69

and measure the amount of symbols with the unit symbol rate.
Figure 48: Figure illustrating the conversion of a digital transmission from 2 levels to 4 levels,
showing that you can transmit the same amount of information in a faster time.
We define l as the number of bits per level, meaning the number of bits each level
represents, and L as the number of levels. l and L are related as




L = 2l or l = log2 (L) 	(85)
Moreover, with multilevel signaling, less bandwidth is needed for the same information
transfer capacity (is symbol rate remains unchanged) or more information can be sent at
the same time, if we increase the number of bits each symbol carries.
6.3.1 Advantages and Disadvantages of multilevel signaling
Using multiple bits per level can increase our data transmission rate. It would seem rea-
sonable that increasing the number of levels to a very high number is the next logical
step.
However, we must be aware of channel effects, and how this will affect what we obtain at
the other end of our communication link, so at the input of the receiver.
For example we can simulate the effects of noise, on both the case where l = 1 (so "one
bit per symbol" transmission), and th

[Truncated for analysis]

### Key points

- Multilevel signaling maps multiple bits to one symbol level.
- A binary stream can be grouped into 2-bit or larger symbols.
- For a 4-level example, $00$, $01$, $10$, and $11$ are mapped to distinct voltages.
- The number of levels and bits per level satisfy $L = 2^l$.
- Using more bits per symbol can reduce the time needed to transmit a fixed amount of data.
- For a fixed information transfer capacity, multilevel signaling can require less bandwidth.

### Related topics

- [[baud-rate-and-bit-rate-relationships|Baud rate and bit rate relationships]]
- [[noise-sensitivity-tradeoff-in-multilevel-signaling|Noise sensitivity tradeoff in multilevel signaling]]
- [[bits-per-sample-versus-bits-per-level|Bits per sample versus bits per level]]

### Relationships

- depends-on: [[baud-rate-and-bit-rate-relationships|Baud rate and bit rate relationships]]
- contrasts-with: [[noise-sensitivity-tradeoff-in-multilevel-signaling|Noise sensitivity tradeoff in multilevel signaling]]
- related: [[bits-per-sample-versus-bits-per-level|Bits per sample versus bits per level]]
