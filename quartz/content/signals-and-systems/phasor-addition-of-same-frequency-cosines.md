---
title: "Phasor Addition of Same-Frequency Cosines"
date: "2026-04-30T16:26:39.261Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "signals-and-systems-full-notes"
source_file: "Signals and Systems full notes.pdf"
locations: ["Page 7"]
related: ["phasors-and-rotating-complex-vectors", "spectrum-representation-of-sums-of-sinusoids", "sinusoidal-amplitude-modulation", "continuous-time-sinusoidal-signal-parameters"]
tags: ["phasor-addition", "cosine-addition", "phasor", "rectangular-form", "polar-form", "same-frequency"]
source_images: ["/signals-and-systems/assets/signals-and-systems-full-notes-page-007.png"]
---

## Phasor Addition of Same-Frequency Cosines

Source: [[signals-and-systems-full-notes|Signals and Systems Full Notes: Sinusoids, Spectra, Sampling, Aliasing, and FIR Filters]]

Locations: Page 7

When multiple cosine signals have the same frequency but different amplitudes and phases, their sum can always be reduced to one cosine at that same frequency. The notes state this as $\sum_{k=1}^{N}A_k\cos(\omega_0t+\phi_k)=A\cos(\omega_0t+\phi)$. The method is to represent each cosine by a phasor, convert each phasor to rectangular form, add real and imaginary parts, and convert the resulting complex number back to polar form. This process is equivalent to a graphical vector sum. In the worked example, $x(t)=2\cos(100\pi t+\pi/6)-2\sqrt{3}\cos(100\pi t-\pi/3)$ is represented by phasors $2e^{j\pi/6}$ and $-2\sqrt{3}e^{-j\pi/3}$. After rectangular conversion and addition, the result is $4j=4e^{j\pi/2}$, so the final sinusoid is $4\cos(100\pi t+\pi/2)$. The key requirement is common frequency; phasor addition does not collapse arbitrary different-frequency sinusoids into one cosine.

### Source snapshots

![Signals and Systems full notes Page 7](/signals-and-systems/assets/signals-and-systems-full-notes-page-007.png)

### Page-grounded details

#### Page 7

- The complex amplitude specifies the initial magnitude and phase of the
phasor, while the frequency w0 specifies the angular velocity of its
rotation in the complex plane

[arrow/label:] same frequency

1.4 Phasor Addition (Cosine Addition)

- There are many situations in which it is necessary to add two or more
sinusoidal signals. When all signals have the same frequency, the addition
simplifies.

\[
\sum_{k=1}^{N} A_k \cos(\omega_0 t + \phi_k) = A \cos(\omega_0 t + \phi)
\]

- The equation above states that a sum of N cosine signals of different
amplitudes and, but with the same frequency, can always be reduced to a single
cosine signal of the same frequency.

The algorithm is as follows:

[large downward arrow]

Ex: calculate \(x(t)=2\cos(100\pi t+\frac{\pi}{6})-2\sqrt{3}\cos(100\pi t-\frac{\pi}{3})\)

Solution:

1. Represent \(x_1(t)\) and \(x_2(t)\) by the phasors

\[
\tilde{x}_1(t)=2e^{j\pi/6}
\]

\[
\tilde{x}_2(t)=-2\sqrt{3}e^{-j\pi/3}
\]

2. Convert phasors to rectangular form

\[
\tilde{x}_1(t)=r\cos(\frac{\pi}{6})+r\sin(\frac{\pi}{6})j
=\frac{2\sqrt{3}}{2}+\frac{2}{2}j=-\sqrt{3}+j
\]

\[
\tilde{x}_2(t)=-\sqrt{3}+3j
\]

3. Add the real and imaginary parts

\[
(-\sqrt{3}+\

[Truncated for analysis]

### Key points

- Same-frequency cosines can be reduced to a single cosine
- Formula: $\sum_{k=1}^{N}A_k\cos(\omega_0t+\phi_k)=A\cos(\omega_0t+\phi)$
- Represent each sinusoid by a phasor
- Convert phasors to rectangular form
- Add the real and imaginary parts
- Convert the sum back to polar form
- Phasor addition is a graphical vector sum
- The worked example reduces to $4\cos(100\pi t+\pi/2)$

### Related topics

- [[phasors-and-rotating-complex-vectors|Phasors and Rotating Complex Vectors]]
- [[spectrum-representation-of-sums-of-sinusoids|Spectrum Representation of Sums of Sinusoids]]
- [[sinusoidal-amplitude-modulation|Sinusoidal Amplitude Modulation]]
- [[continuous-time-sinusoidal-signal-parameters|Continuous-Time Sinusoidal Signal Parameters]]

### Relationships

- depends-on: [[phasors-and-rotating-complex-vectors|Phasors and Rotating Complex Vectors]]
- applies-to: [[continuous-time-sinusoidal-signal-parameters|Continuous-Time Sinusoidal Signal Parameters]]
