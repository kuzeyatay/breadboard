---
title: "Spectrum Representation of Sums of Sinusoids"
date: "2026-04-30T16:26:39.261Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "signals-and-systems-full-notes"
source_file: "Signals and Systems full notes.pdf"
locations: ["Page 8"]
related: ["complex-exponential-signals", "conjugate-symmetry-and-line-spectra", "periodic-signals-and-harmonics"]
tags: ["spectrum", "frequency-domain", "time-domain", "two-sided-spectrum", "complex-conjugate", "phasor"]
source_images: ["/signals-and-systems/assets/signals-and-systems-full-notes-page-008.png"]
---

## Spectrum Representation of Sums of Sinusoids

Source: [[signals-and-systems-full-notes|Signals and Systems Full Notes: Sinusoids, Spectra, Sampling, Aliasing, and FIR Filters]]

Locations: Page 8

The spectrum representation describes a signal by the sinusoidal or complex-exponential components needed to synthesize it. A real signal formed from a constant and $N$ sinusoids is written $x(t)=A_0+\sum_{k=1}^{N}A_k\cos(2\pi F_kt+\phi_k)$. Using phasors, it can be written as $x(t)=X_0+\sum_{k=1}^{N}\operatorname{Re}(X_ke^{j2\pi F_kt})$, where $X_0=A_0$ is a real constant. Applying Euler formulas produces a two-sided spectrum: $x(t)=X_0+\sum_{k=1}^{N}\{\frac{X_k}{2}e^{j2\pi F_kt}+\frac{X_k^*}{2}e^{-j2\pi F_kt}\}$. This uses $2N+1$ frequencies: zero, positive frequencies, and matching negative frequencies. Each spectral pair $(F_k,\frac{1}{2}X_k)$ gives the size and relative phase of the complex exponential component at that frequency. The time domain gives waveform values, while the frequency domain gives the information required to synthesize the signal.

### Source snapshots

![Signals and Systems full notes Page 8](/signals-and-systems/assets/signals-and-systems-full-notes-page-008.png)

### Page-grounded details

#### Page 8

Chapter 2. Spectrum Representation

2.1 The spectrum Sum of Sinusoids

- In this chapter, we will show some complicated looking waveforms that can be constructed from other simple combinations of basic cosine waves. The most general and powerful method for producing new signals from sinusoids is the additive linear combination, where a real signal is created by adding together a constant and N sinusoids, each with a different frequency, amplitude and phase. If the signal is real, it may be represented by the left hand side in

x(t) = A_0 + sumₖ₌_1ᴺ Aₖ cos(2πFₖt + ϕₖ)    (1)

⇔ x(t) = X_0 + sumₖ₌_1ᴺ Re(Xₖ eʲ^2πFₖt)    where Xₖ is the phasor

[arrow/label under X_0:] real constant (= A_0)

We can also use the inverse Euler formula sin x = (eʲθ - e⁻ʲθ)/2j, cos x = (eʲθ + e⁻ʲθ)/2.

x(t) = X_0 + sumₖ₌_1ᴺ { Xₖ/2 eʲ^2πFₖt + Xₖ*/2 e⁻ʲ^2πFₖt }    (2)

where Xₖ* is the complex conjugate of Xₖ

The signal representation in (2) is called the two-sided spectrum, because it uses 2N+1 positive and negative frequencies along with the corresponding 2N+1 complex amplitudes to specify a signal composed of sinusoids (1). To be specific, our definition of the spectrum is the set of pairs

=> { (0, X_0)

[Truncated for analysis]

### Key points

- A real signal can be created by adding a constant and sinusoids
- Sinusoidal form: $x(t)=A_0+\sum_{k=1}^{N}A_k\cos(2\pi F_kt+\phi_k)$
- Phasor form: $x(t)=X_0+\sum_{k=1}^{N}\operatorname{Re}(X_ke^{j2\pi F_kt})$
- $X_0$ is the real constant equal to $A_0$
- Two-sided spectrum uses positive and negative frequencies
- Negative-frequency complex amplitudes use complex conjugates
- Each pair gives frequency, size, and relative phase
- Frequency domain representation gives synthesis information rather than waveform samples

### Related topics

- [[complex-exponential-signals|Complex Exponential Signals]]
- [[conjugate-symmetry-and-line-spectra|Conjugate Symmetry and Line Spectra]]
- [[periodic-signals-and-harmonics|Periodic Signals and Harmonics]]

### Relationships

- depends-on: [[complex-exponential-signals|Complex Exponential Signals]]
