---
title: "Instruction Exercises on Information Theory"
date: "2026-04-25T10:25:58.869Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "communications-1-coursereader"
source_file: "Communications_1_CourseReader.pdf"
locations: ["Page 109"]
related: ["shannon-hartley-channel-capacity-theorem", "power-limited-and-bandwidth-limited-channel-operation", "information-theory-motivation-and-error-control-need"]
tags: ["pcm", "awgn", "nrz", "bipolar-rz", "channel-capacity", "week-5"]
source_images: ["/communication-1/assets/communications-1-coursereader-page-109-2.png"]
---

## Instruction Exercises on Information Theory

Source: [[communications-1-coursereader|Communications 1 Course Reader - Sampling, PAM, PCM, and Noise]]

Locations: Page 109

The information theory exercise section applies the chapter's concepts to realistic design and analysis problems. The first exercise combines sampling, quantization, PCM coding, binary transmission, AWGN, and required recovered-signal SNR, asking for the maximum allowable bit error rate, the minimum SNR of the received binary signal, and how distortion-free transmission can still be achieved if the channel bandwidth is limited. The second exercise centers on Shannon capacity and practical signaling tradeoffs. It asks for the required SNR to support 4 Gb/s in 1 GHz bandwidth under thermal noise, the necessary signal power given a specific noise power, whether doubling bandwidth doubles bit rate, and how much more bandwidth is needed to raise capacity from 4 Gb/s to 5 Gb/s. It then connects back to line coding by asking about the actual bandwidth of Bipolar RZ signaling with 50% pulse width and how reducing the pulse width to 25% changes the bandwidth. These problems demonstrate how the chapter's formulas become engineering tools.

### Source snapshots

![Communications_1_CourseReader Page 109](/communication-1/assets/communications-1-coursereader-page-109-2.png)

### Page-grounded details

#### Page 109

9.5 Instruction exercises - Information Theory
The solutions to these exercises may be found under the page 5ETC0 Canvas Page Mod-
ules -> Week 5 -> G. Information theory
Exercise 17) (Video solution available) A music signal w(t) is band-limited to B
= 20 kHz. The signal is sampled with a frequency fs = 50 kHz. The samples are uniformly
quantized and coded into a PCM signal of 12 bits/sample, and sent as unipolar binary NRZ
symbols over a channel with an ideal low-pass characteristic and is disturbed by additive
white Gaussian noise. In the receiver detection of the digital signal and restoration of the
music signal takes place. The required minimum signal to noise ratio of the recovered signal
is 60 dB.
- a) What is the maximum allowable bit error rate when the required signal-to-noise
ratio is achieved?
- b) What is the minimum signal to noise ratio of the received binary signal?
- c) If the bandwidth of the channel is limited, how still distortion-free transmission of
the PCM signal can be achieved?
Exercise 18) (Video solution available) A data signal is transported by means of a
transmission system. The system operator has purchased from the government 1GHz of
bandwidth and w

[Truncated for analysis]

### Key points

- Exercises connect capacity theory to PCM and AWGN transmission.
- One exercise asks for maximum allowable BER given a required recovered-signal SNR.
- Another asks for the SNR needed for 4 Gb/s in a 1 GHz channel.
- Signal power is computed from required SNR and given noise power.
- Bandwidth-versus-bit-rate tradeoffs are explicitly examined.
- The section also includes practical questions on Bipolar RZ bandwidth.

### Related topics

- [[shannon-hartley-channel-capacity-theorem|Shannon-Hartley Channel Capacity Theorem]]
- [[power-limited-and-bandwidth-limited-channel-operation|Power-Limited and Bandwidth-Limited Channel Operation]]
- [[information-theory-motivation-and-error-control-need|Information Theory Motivation and Error Control Need]]

### Relationships

- applies-to: [[shannon-hartley-channel-capacity-theorem|Shannon-Hartley Channel Capacity Theorem]]
- applies-to: [[power-limited-and-bandwidth-limited-channel-operation|Power-Limited and Bandwidth-Limited Channel Operation]]
