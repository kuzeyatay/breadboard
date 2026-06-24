---
title: "Sinusoidal Amplitude Modulation"
date: "2026-04-30T16:26:39.261Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "signals-and-systems-full-notes"
source_file: "Signals and Systems full notes.pdf"
locations: ["Page 10"]
related: ["spectrum-representation-of-sums-of-sinusoids", "phasor-addition-of-same-frequency-cosines", "periodic-signals-and-harmonics"]
tags: ["amplitude-modulation", "product-signal", "beat-note", "envelope", "bandwidth", "communication-systems"]
source_images: ["/signals-and-systems/assets/signals-and-systems-full-notes-page-010.png"]
---

## Sinusoidal Amplitude Modulation

Source: [[signals-and-systems-full-notes|Signals and Systems Full Notes: Sinusoids, Spectra, Sampling, Aliasing, and FIR Filters]]

Locations: Page 10

Amplitude modulation is introduced as a product model for sinusoids. Since the spectrum representation is based on additive sums of complex exponentials, a product of sinusoids must be rewritten as a sum before its spectrum can be obtained. The notes use the example $x(t)=\cos(\pi t)\sin(10\pi t)$ and rewrite it through Euler formulas as a sum of two cosines: $x(t)=\frac{1}{2}\cos(11\pi t-\pi/2)+\frac{1}{2}\cos(9\pi t-\pi/2)$. This shows that multiplying sinusoids creates new frequency components at the sum and difference frequencies. In communication systems, amplitude modulation is the process of multiplying a high-frequency sinusoid by a low-frequency message signal so the message controls the envelope of the carrier. The envelope gives the signal boundaries in the time plot. Bandwidth is defined as the difference between the highest and lowest positive frequency components that contain significant energy.

### Source snapshots

![Signals and Systems full notes Page 10](/signals-and-systems/assets/signals-and-systems-full-notes-page-010.png)

### Page-grounded details

#### Page 10

2.2 Sinusoidal Amplitude Modulation:

- Sofar we have considered signals that can be represented as sums of sinusoids
of different frequencies, but another useful mathematical signal model
is the product of sinusoids. this multiplication can cause an interesting
audio effect called a "beat note".

-> A signal produced by multiplying two sinusoids must be rewritten as
a sum in order to obtain its spectrum, because our spectrum is a
graphical representation of an additive linear combination of
complex exponential signals.

| ex/ spectrum of a product signal.

Represent the signal x(t) = cos(πt) sin(10πt) in the fourier domain
representation.

Solution: it is necessary to rewrite x(t) as a sum before its
spectrum can be defined. One approach is to use the inverse euler formula
as follows:

x(t) = ( e^(jπt) + e^(-jπt) / 2 ) ( e^(j10πt+π/2) + e^(-j10πt+π/2) / 2 )

= 1/4 ( e^(j11πt+π/2) + e^(j9πt+π/2) + e^(-j9πt-π/2) + e^(-j11πt-π/2) )

= 1/2 cos(11πt - π/2) + 1/2 cos(9πt - π/2)

[small note with arrow:] The output will always have equal amplitude

=> Amplitude Modulation

[Diagram: graph with vertical axis arrow upward and horizontal axis arrow right. The vertical axis is labeled 1 near

[Truncated for analysis]

### Key points

- Products of sinusoids must be rewritten as sums to obtain spectra
- Multiplication creates sum and difference frequency components
- Example product: $x(t)=\cos(\pi t)\sin(10\pi t)$
- Example sum: $\frac{1}{2}\cos(11\pi t-\pi/2)+\frac{1}{2}\cos(9\pi t-\pi/2)$
- Amplitude modulation multiplies a high-frequency sinusoid by a low-frequency message signal
- The low-frequency signal modulates the envelope of the high-frequency sinusoid
- Bandwidth is the difference between highest and lowest significant positive frequency components
- The output of the example product has equal amplitudes for the two generated components

### Related topics

- [[spectrum-representation-of-sums-of-sinusoids|Spectrum Representation of Sums of Sinusoids]]
- [[phasor-addition-of-same-frequency-cosines|Phasor Addition of Same-Frequency Cosines]]
- [[periodic-signals-and-harmonics|Periodic Signals and Harmonics]]

### Relationships

- applies-to: [[spectrum-representation-of-sums-of-sinusoids|Spectrum Representation of Sums of Sinusoids]]
