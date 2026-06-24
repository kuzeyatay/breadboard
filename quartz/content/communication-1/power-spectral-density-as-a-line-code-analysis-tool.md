---
title: "Power spectral density as a line-code analysis tool"
date: "2026-04-25T10:25:58.869Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "communications-1-coursereader"
source_file: "Communications_1_CourseReader.pdf"
locations: ["Page 74", "Page 75"]
related: ["unipolar-and-polar-nrz-spectral-properties", "rz-and-manchester-line-code-spectral-properties", "psd-conversion-for-multilevel-signaling-and-spectral-efficiency"]
tags: ["power-spectral-density", "autocorrelation", "line-coding", "fourier-transform", "psd"]
source_images: ["/communication-1/assets/communications-1-coursereader-page-074-2.png", "/communication-1/assets/communications-1-coursereader-page-075-2.png"]
---

## Power spectral density as a line-code analysis tool

Source: [[communications-1-coursereader|Communications 1 Course Reader - Sampling, PAM, PCM, and Noise]]

Locations: Page 74, Page 75

Power spectral density is introduced as the main frequency-domain tool for studying line codes. Unlike the Fourier transform of a single deterministic waveform, PSD characterizes how average signal power is distributed over frequency for random or varying signals, which is the natural setting for digital data streams. This makes PSD especially useful for estimating required channel bandwidth and understanding how line coding choices influence spectral occupancy and noise behavior. The derivation begins with autocorrelation, which measures similarity between a signal and a delayed version of itself. For continuous signals, the Fourier transform of the autocorrelation function yields the PSD. For discrete random symbol sequences, the text gives a discrete autocorrelation expression using symbol products and their probabilities, and then expresses the PSD in terms of the symbol pulse spectrum, symbol period, and the autocorrelation sequence. This theoretical framework supports the later formulas for specific line codes such as Unipolar NRZ and Manchester.

### Source snapshots

![Communications_1_CourseReader Page 74](/communication-1/assets/communications-1-coursereader-page-074-2.png)

![Communications_1_CourseReader Page 75](/communication-1/assets/communications-1-coursereader-page-075-2.png)

### Page-grounded details

#### Page 74

7 Linecodes and their spectras
7.1 Learning objectives
Students completing this chapter should have learned:
1. Understand the concept of Power Spectral Density and its connection to the choice of
line coding.
2. Able to quantitatively discuss the properties of a PSD for any of the 5 line codes
specifically detailed in this chapter.
3. Able to calculate the impact of a choice of line code on the spectral efficiency and the
required bandwidth of a communication channel.
7.2 Motivation
Line coding plays a crucial role in converting digital bits into waveforms for physical trans-
mission. Building on the concepts introduced in the digital signaling chapter, where binary
data was processed and transmitted, this chapter explains how different coding methods
shape these signals to suit real-world channels. The chapter explores various techniques and
discusses their impact on bandwidth usage and noise resistance.
PCM Signaling
(Line coding)
101011010
1 0 1 0 1 1 0 1 0
Figure 52: Digital signaling and line coding - Topic map location
7.3 Power spectral density (PSD)
Power spectral density (PSD) is a tool that shows how the power of a signal is spread
over different frequencies. In many cas

[Truncated for analysis]

#### Page 75

where W (f ) is the Fourier transform of the signal, and Pw(f ) represents its power spectral
density (see Appendix C for derivation of Eq.(90))
The Fourier transform converts the time-domain signal into its frequency components.
When applied to the autocorrelation function, it shows how much power is present at each
frequency, which is crucial for understanding the signal's overall bandwidth usage.
For digital signals that consist of discrete symbols, a discrete version of autocorrelation is
used:
R(k) =
I	X
i=1
(an * an+k)i Pi (91)
Here, Pi is the probability of the i-th product (an * an+k)i, and I is the number of pos-
sible pairs (an, an+k). This version takes into account the randomness inherent in digital
signals.
Using the relationship between the Fourier transform of the autocorrelation function and
the PSD (see (90)), the PSD for a random digital signal can be written as:

Ps(f ) = limT ->∞ |ST (f )|2
T = |F (f )|2
Ts
P∞
k=-∞ R(k) ej2πkf Ts 	(92)
In this equation, Ts is the symbol period, and the sum over k accounts for the contributions
from all time delays.
After converting binary information from the quantizer and PCM stages into symbols, these
symbols are transformed

[Truncated for analysis]

### Key points

- PSD shows how signal power is spread over frequency.
- PSD is more appropriate than a simple Fourier transform for random digital signals.
- Autocorrelation is the central quantity used to derive PSD.
- For continuous signals, the Fourier transform of autocorrelation gives PSD.
- For random digital symbols, a discrete autocorrelation sequence is used.
- Line-code PSD determines bandwidth efficiency and influences system performance.

### Related topics

- [[unipolar-and-polar-nrz-spectral-properties|Unipolar and polar NRZ spectral properties]]
- [[rz-and-manchester-line-code-spectral-properties|RZ and Manchester line-code spectral properties]]
- [[psd-conversion-for-multilevel-signaling-and-spectral-efficiency|PSD conversion for multilevel signaling and spectral efficiency]]

### Relationships

- depends-on: [[unipolar-and-polar-nrz-spectral-properties|Unipolar and polar NRZ spectral properties]]
- depends-on: [[rz-and-manchester-line-code-spectral-properties|RZ and Manchester line-code spectral properties]]
- depends-on: [[psd-conversion-for-multilevel-signaling-and-spectral-efficiency|PSD conversion for multilevel signaling and spectral efficiency]]
