---
title: "Bits per sample versus bits per level"
date: "2026-04-25T10:25:58.869Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "communications-1-coursereader"
source_file: "Communications_1_CourseReader.pdf"
locations: ["Page 71"]
related: ["multilevel-signaling-concept-and-efficiency", "baud-rate-and-bit-rate-relationships", "instruction-exercises-on-pcm-digitization"]
tags: ["bits-per-sample", "bits-per-level", "quantization", "line-coding", "pcm"]
source_images: ["/communication-1/assets/communications-1-coursereader-page-071-2.png"]
---

## Bits per sample versus bits per level

Source: [[communications-1-coursereader|Communications 1 Course Reader - Sampling, PAM, PCM, and Noise]]

Locations: Page 71

The text explicitly distinguishes two quantities that are often confused in digital communication systems. Bits per sample, denoted $n$, belong to the digitization stage and specify how many bits are used to represent each sampled value of the original analog signal. This determines the information content and quantization resolution of the digital representation. Bits per level, denoted $l$, belong to the line coding or signaling stage and specify how many bits are represented by one transmitted signal level or symbol. These are therefore parameters of two different parts of the communication chain: quantization and waveform transmission. A system can have high quantization resolution but still use binary signaling, or it can use lower or higher order multilevel signaling independent of the quantizer resolution. This distinction is essential for reasoning correctly about bit rate, symbol rate, required bandwidth, and noise sensitivity.

### Source snapshots

![Communications_1_CourseReader Page 71](/communication-1/assets/communications-1-coursereader-page-071-2.png)

### Page-grounded details

#### Page 71

6.3.2 Bits per sample and bits per level, the difference
Bits per sample n refers to the number of bits used to represent each sample of an analog
signal in a digital domain. Bits per sample is a parameter in the digitization stage and
determines the amount of information of the sampled analog signals.
On the other hand, bits per level l refer to the number of bits a level represents in multilevel
signaling schemes. Bits per level is a parameter in the line coding stage.
Thus, bits per sample and bits per level are two different concepts in two different stages of
the communication chain
Quantization
(Digitization)
PCM Signaling
(Line coding)
101
010
110
001
010 	101011010
1 0 1 0 1 1 0 1 0
67

### Key points

- Bits per sample $n$ belong to the digitization stage.
- Bits per sample determine the information content of sampled analog signals.
- Bits per level $l$ belong to the line coding stage.
- Bits per level determine how many bits each symbol represents.
- These two parameters apply to different stages of the communication chain.
- Confusing $n$ and $l$ leads to errors in rate and bandwidth calculations.

### Related topics

- [[multilevel-signaling-concept-and-efficiency|Multilevel signaling concept and efficiency]]
- [[baud-rate-and-bit-rate-relationships|Baud rate and bit rate relationships]]
- [[instruction-exercises-on-pcm-digitization|Instruction exercises on PCM digitization]]

### Relationships

- depends-on: [[baud-rate-and-bit-rate-relationships|Baud rate and bit rate relationships]]
