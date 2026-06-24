---
title: "Bit Rate and Spectral Efficiency in PCM"
date: "2026-04-25T10:25:58.869Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "communications-1-coursereader"
source_file: "Communications_1_CourseReader.pdf"
locations: ["Page 43", "Page 45"]
related: ["pulse-code-modulation-and-quantization-process", "pcm-bandwidth-requirements", "worked-example-for-required-transmit-power"]
tags: ["bit-rate", "spectral-efficiency", "pcm", "sampling-frequency", "bits-per-sample", "line-coding"]
source_images: ["/communication-1/assets/communications-1-coursereader-page-043-2.png", "/communication-1/assets/communications-1-coursereader-page-045-2.png"]
---

## Bit Rate and Spectral Efficiency in PCM

Source: [[communications-1-coursereader|Communications 1 Course Reader - Sampling, PAM, PCM, and Noise]]

Locations: Page 43, Page 45

The text defines the PCM bit rate as the product of the number of bits per sample and the sampling frequency. If an analog signal is sampled $f_s$ times per second and each sample is represented by $n$ bits, then the resulting bit rate is $$R = n f_s \quad [\text{bits/s}].$$ This directly links quantization resolution and sampling rate to the amount of digital traffic generated. The section then defines spectral efficiency as the number of bits per second that can be carried per hertz of bandwidth, $$\eta = \frac{R}{B} \quad (\text{bits/s})/\text{Hz}.$$ Here, $B$ refers to the bandwidth occupied by the PCM signal, which depends not only on $R$ but also on the waveform or line coding used to represent the bits and the number of bits packed into each symbol. The text notes that symbol-rate-based reasoning also becomes useful because line coding determines the spectral footprint of the transmitted PCM waveform. This topic forms the bridge between digital source generation and physical-channel bandwidth planning: once $n$ and $f_s$ are chosen, $R$ is fixed, and the spectral efficiency of the chosen coding determines the required transmission bandwidth.

### Source snapshots

![Communications_1_CourseReader Page 43](/communication-1/assets/communications-1-coursereader-page-043-2.png)

![Communications_1_CourseReader Page 45](/communication-1/assets/communications-1-coursereader-page-045-2.png)

### Page-grounded details

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

#### Page 45

5.3.3 Spectral efficiency η
The spectral efficiency of a digital signal is given by the number of bits per second of data
that can be supported by each hertz of bandwidth. That is,




η = R
B (bits/s)/Hz 	(63)
Where R is the bit rate (or data rate) and B is the bandwidth of a PCM signal. The bit
rate R, can be directly derived from the sampling frequency and number of quantization
bits (see Eq. 62). The bandwidth B, needed for successfully sending the information with a
bit rate R, is determined by the type of line coding used and the number of bits included in
each symbol (this will be elaborated upon later in this reader). Hence it is sometimes also
valuable to consider efficiency in terms of symbols/sec/Hz. If symbol rate (D) is known,
and the spectral properties of the chosen line coding are known (shape and number of bits
per symbol), one can deduce the required bandwidth for successful transmission. We derive
in chapter 6 a lower bound for the required bandwidth for a communication channel based
on the symbol rate D.
5.3.4 PCM Bandwidth
Since we want to transmit PCM signals (binary waveforms), the bandwidth of binary PCM
waveforms is important. Because most channels have

[Truncated for analysis]

### Key points

- PCM bit rate is $R = n f_s$.
- Increasing bits per sample or sampling frequency raises the bit rate.
- Spectral efficiency is defined as $\eta = R/B$.
- The required bandwidth depends on both bit rate and line coding.
- Symbol rate and bits per symbol also matter for bandwidth planning.

### Related topics

- [[pulse-code-modulation-and-quantization-process|Pulse Code Modulation and Quantization Process]]
- [[pcm-bandwidth-requirements|PCM Bandwidth Requirements]]
- [[worked-example-for-required-transmit-power|Worked Example for Required Transmit Power]]

### Relationships

- depends-on: [[pcm-bandwidth-requirements|PCM Bandwidth Requirements]]
