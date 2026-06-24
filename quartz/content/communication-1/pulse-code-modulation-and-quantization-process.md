---
title: "Pulse Code Modulation and Quantization Process"
date: "2026-04-25T10:25:58.869Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "communications-1-coursereader"
source_file: "Communications_1_CourseReader.pdf"
locations: ["Page 42", "Page 43"]
related: ["bit-rate-and-spectral-efficiency-in-pcm", "pcm-bandwidth-requirements", "receiver-output-signal-to-noise-ratio-in-pcm"]
tags: ["pcm", "quantization", "adc", "quantization-levels", "bits-per-sample", "serial-encoding"]
source_images: ["/communication-1/assets/communications-1-coursereader-page-042-2.png", "/communication-1/assets/communications-1-coursereader-page-043-2.png"]
---

## Pulse Code Modulation and Quantization Process

Source: [[communications-1-coursereader|Communications 1 Course Reader - Sampling, PAM, PCM, and Noise]]

Locations: Page 42, Page 43

Pulse code modulation (PCM) is presented as the process that converts sampled analog values into a stream of digital bits. In this chunk, the starting point is a flat-top sampled analog waveform that must be transformed into digital codewords by an analog-to-digital converter (ADC). The quantization procedure divides an analog voltage range, such as from -5 V to 7 V, into $M$ discrete levels and assigns a binary codeword to each level. Each sample is then rounded to the nearest quantization level, producing a digital representation of $n$ bits per sample. The relation between levels and bits is given by $M = 2^n$. The text also shows that the parallel output bits from the ADC are serialized into a bit stream for later line coding, transmission, and possibly error-control processing. The core conceptual point is that PCM has two linked abstractions: amplitude discretization through quantization and sequential digital representation through binary encoding. The cost of this conversion is quantization error, but the benefit is that analog information becomes suitable for digital transmission and processing.

### Source snapshots

![Communications_1_CourseReader Page 42](/communication-1/assets/communications-1-coursereader-page-042-2.png)

![Communications_1_CourseReader Page 43](/communication-1/assets/communications-1-coursereader-page-043-2.png)

### Page-grounded details

#### Page 42

5 Digitization
5.1 Learning objectives
Students completing this chapter should have learned:
1. Can derive the bit rate, symbol rate and bandwidth requirements for a digital trans-
mission system based on the original analog signal and the sampling of it.
2. Understand the impact of the number of quantization levels and the limiting factors
for quantization.
3. Understand and be able to indicate which noise mechanism (quantization or bit er-
ror rate) dominates the SNR of the reconstructed signal in a digital communication
system.
4. Can calculate the required Bpcm bandwidth for a digitized signal with n quantization
bits.
5. Can find/calculate the signal to noise ratio (SN Rin) at the entrance of a receiver
based on the required Bit Error Rate (BER)
6. Can calculate the BER based on the SN Rin using the Q function.
7. Understand the fact that increasing or decreasing the number of quantization bits
does not always lead to a respective increase or decrease in SN Rout performance.
5.2 Motivation
In this chapter, we transition from understanding the sampling of analog signals to the
conversion of these samples into a digital binary stream. Pulse Code Modulation (PCM) lies
at the hear

[Truncated for analysis]

#### Page 43

sampling and sampling methods. In this section, we discuss quantization in detail and its
performance. We will assume throughout this section that we have an incoming flat-top
sampled signal from the sampling stage, which is still analog, and now we need to convert it
to a digital bit stream. This conversion is done through quantization. From the name, this
means actually transforming the samples into a sequence of bits (thus we make an analog-
to-digital conversion (ADC)). In hardware, this implies an ADC circuit will be used (the
electronic and circuit aspects of ADC are beyond the scope of this course and are handled
in other courses in the EE curriculum).
During quantization, we start by separating a voltage range (for ex -5 V to 7 V) into M
levels, and we assign a binary codeword to each of the levels. Then, we can represent any
voltage level with a binary code word by rounding it to the nearest level, and in this way,
we essentially convert the analog samples into digital codewords of n bits. This concept
is illustrated in Fig. 27. We may note that the number of quantization levels M is
expressed as 


M = 2n (61)
where n is the number of bits per sample. Furthermore, the

[Truncated for analysis]

### Key points

- PCM converts sampled analog values into a stream of bits.
- The input to quantization is still analog, even after flat-top sampling.
- Quantization divides the analog voltage range into $M$ discrete levels.
- Each level receives a binary codeword of length $n$ bits.
- The number of quantization levels is $M = 2^n$.
- Samples are rounded to the nearest level during quantization.
- ADC output bits are serialized into a digital stream for transmission.

### Related topics

- [[bit-rate-and-spectral-efficiency-in-pcm|Bit Rate and Spectral Efficiency in PCM]]
- [[pcm-bandwidth-requirements|PCM Bandwidth Requirements]]
- [[receiver-output-signal-to-noise-ratio-in-pcm|Receiver Output Signal-to-Noise Ratio in PCM]]

### Relationships

- depends-on: [[bit-rate-and-spectral-efficiency-in-pcm|Bit Rate and Spectral Efficiency in PCM]]
- related: [[receiver-output-signal-to-noise-ratio-in-pcm|Receiver Output Signal-to-Noise Ratio in PCM]]

## Added from [[topicmap|Communications 1 (5ETC0) Topic Map]]

Source label: Topic map for the full course

Locations: Page 1

The topic map uses several binary strings to illustrate how messages are represented and transported in a digital communication system. Short grouped patterns such as 101, 010, 110, 001, and 010 appear near the digitization and PCM signaling stages, while longer streams such as 101011010 and 001011011 appear along the transmission and receiver paths. The repeated bitstream "1 0 1 0 1 1 0 1 0" is shown both before and after the physical channel, suggesting that an ideal or correctly received line-coded sequence should preserve the transmitted bits. Another stream, 001011011, appears near the error-detection stage with the label "Error detected," illustrating that received data may differ from the intended transmitted sequence. These examples ground the abstract communication chain in concrete binary data representations.

### Source snapshots

![TopicMap Page 1](/communication-1/assets/topicmap-page-001.png)

### New key points

- The source shows grouped binary code fragments including 101, 010, 110, 001, and 010.
- A longer bitstream "101011010" appears as a transmitted or decoded sequence.
- The bit sequence "1 0 1 0 1 1 0 1 0" appears around the channel path.
- The stream "001011011" appears near the receiver side.
- The label "Error detected" is attached to a received bitstream example.
- The examples show how digital messages can be represented, transmitted, and checked.
