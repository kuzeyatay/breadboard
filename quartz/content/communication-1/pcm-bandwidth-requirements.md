---
title: "PCM Bandwidth Requirements"
date: "2026-04-25T10:25:58.869Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "communications-1-coursereader"
source_file: "Communications_1_CourseReader.pdf"
locations: ["Page 45"]
related: ["bit-rate-and-spectral-efficiency-in-pcm", "aliasing-and-nyquist-sampling-criterion", "receiver-output-signal-to-noise-ratio-in-pcm", "relating-input-and-output-snr-in-digital-communication"]
tags: ["pcm-bandwidth", "intersymbol-interference", "spectral-efficiency", "bit-rate", "line-coding", "nyquist-sampling-rate"]
source_images: ["/communication-1/assets/communications-1-coursereader-page-045-2.png"]
---

## PCM Bandwidth Requirements

Source: [[communications-1-coursereader|Communications 1 Course Reader - Sampling, PAM, PCM, and Noise]]

Locations: Page 45

The PCM bandwidth section explains that binary waveforms require channel bandwidth, and insufficient bandwidth causes pulse spreading into adjacent bit intervals, leading to intersymbol interference (ISI). The text links this bandwidth question to both source sampling and line coding. Starting from anti-aliasing, the analog signal must be sampled with $f_s \ge 2B$, where $B$ is the analog input bandwidth. From the dimensionality theorem, the text states that the minimum bandwidth of a binary encoded PCM waveform is bounded by $$B_{pcm} \ge \frac{1}{2}R = \frac{1}{2}n f_s \ge nB.$$ This lower bound is achieved only for sinc pulse shapes, not for common rectangular-like pulses, which generally require more bandwidth. A more general formula is then provided: $$B_{pcm} = \frac{1}{\eta} n f_s,$$ where $\eta$ is the spectral efficiency of the line coding. The durable insight is that digitization usually expands bandwidth demand: with $n$ bits per sample, PCM needs at least roughly $n$ times the analog bandwidth under ideal conditions, and often more in practical signaling. Thus the digital link budget must account not only for quantization quality but also for channel spectral resources.

### Source snapshots

![Communications_1_CourseReader Page 45](/communication-1/assets/communications-1-coursereader-page-045-2.png)

### Page-grounded details

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

- Insufficient PCM bandwidth causes filtering and intersymbol interference.
- The analog input must still satisfy $f_s \ge 2B$ to avoid aliasing.
- The minimum binary PCM bandwidth is bounded by $B_{pcm} \ge \frac{1}{2}R = \frac{1}{2}n f_s$.
- This also implies $B_{pcm} \ge nB$.
- The lower bound assumes sinc pulse shaping.
- Practical rectangular-like pulse shapes require more bandwidth.
- The general bandwidth formula is $B_{pcm} = \frac{1}{\eta} n f_s$.

### Related topics

- [[bit-rate-and-spectral-efficiency-in-pcm|Bit Rate and Spectral Efficiency in PCM]]
- [[aliasing-and-nyquist-sampling-criterion|Aliasing and Nyquist Sampling Criterion]]
- [[receiver-output-signal-to-noise-ratio-in-pcm|Receiver Output Signal-to-Noise Ratio in PCM]]
- [[relating-input-and-output-snr-in-digital-communication|Relating Input and Output SNR in Digital Communication]]

### Relationships

- depends-on: [[bit-rate-and-spectral-efficiency-in-pcm|Bit Rate and Spectral Efficiency in PCM]]
- depends-on: [[aliasing-and-nyquist-sampling-criterion|Aliasing and Nyquist Sampling Criterion]]
- related: [[relating-input-and-output-snr-in-digital-communication|Relating Input and Output SNR in Digital Communication]]
