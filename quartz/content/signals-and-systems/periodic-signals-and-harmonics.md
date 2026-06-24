---
title: "Periodic Signals and Harmonics"
date: "2026-04-30T16:26:39.261Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "signals-and-systems-full-notes"
source_file: "Signals and Systems full notes.pdf"
locations: ["Page 12", "Page 13"]
related: ["spectrum-representation-of-sums-of-sinusoids", "fourier-series-coefficients-and-line-spectra", "sinusoidal-amplitude-modulation"]
tags: ["periodic-waveforms", "harmonic", "fundamental-frequency", "fundamental-period", "dc-component", "gcd"]
source_images: ["/signals-and-systems/assets/signals-and-systems-full-notes-page-012.png", "/signals-and-systems/assets/signals-and-systems-full-notes-page-013.png"]
---

## Periodic Signals and Harmonics

Source: [[signals-and-systems-full-notes|Signals and Systems Full Notes: Sinusoids, Spectra, Sampling, Aliasing, and FIR Filters]]

Locations: Page 12, Page 13

A periodic signal satisfies $x(t+T_0)=x(t)$ for all $t$, meaning it repeats every $T_0$ seconds. If $T_0$ is the smallest repetition interval, it is called the fundamental period. A sum of sinusoids synthesizes a periodic signal when the frequencies are harmonically related, meaning each component frequency is an integer multiple of a fundamental frequency $F_0$. The general harmonic synthesis form is $x(t)=A_0+\sum_{k=1}^{N}A_k\cos(2\pi kF_0t+\phi_k)$, where $f_k=kF_0$. The term $A_0$ is the DC component, equivalent to zero frequency. The fundamental frequency can be found as $F_0=\gcd\{f_k\}$ for $k=1,2,\ldots,N$, and the fundamental period is $T_0=1/F_0$. The example $x(t)=2\cos(20\pi t)-\frac{1}{3}\cos(60\pi t)+\frac{1}{5}\cos(100\pi t)$ has frequencies $10$, $30$, and $50$ Hz, so $F_0=10$ Hz and the components are the first, third, and fifth harmonics. If frequencies have no harmonic relation, such as $10$, $10\sqrt{8}$, and $10\sqrt{57}$ Hz, there is no greatest common divisor and the waveform is nonperiodic.

### Source snapshots

![Signals and Systems full notes Page 12](/signals-and-systems/assets/signals-and-systems-full-notes-page-012.png)

![Signals and Systems full notes Page 13](/signals-and-systems/assets/signals-and-systems-full-notes-page-013.png)

### Page-grounded details

#### Page 12

2.3 Periodic Waveforms:

- A periodic signal satisfies the condition that x(t+To) = x(t) for all t
which states that the signal repeats its values every To s. The time
interval To is called the period of x(t), and if it is the smallest such repetition
interval, it is called the fundamental period.

In this section, we study how a sum of sinusoids can be used to synthesize
a periodic signal, and we saw, that the sumed sinusoids must have harmonically
related frequencies that are integer multiples of one frequency Fo. In other
words, the signal would be synthesized as the sum of N+1 sinusoids

        x(t) = Ao +  Σ  Ak cos (2π k Fo t + ϕk)          (1)
                    k=1
                    N

where the frequency, fk, of the kth cosine component is

        fk = k Fo.

and Ao, which is the DC component and a sinusoid with zero frequency.

-> The frequency fk is called the kth harmonic of Fo because it is an integer
   multiple of the basic frequency Fo which is called the fundamental
   frequency if its largest such Fo.

- Does the sum in (1) give a periodic signal, and if so, what is the period of
  x(t)? To = 1/Fo is the shortest repetition interval, so its called the
  funda

[Truncated for analysis]

#### Page 13

Periodic Signal
---------------

[Diagram: graph of a periodic waveform versus time. Horizontal axis labeled `t` with arrow to the right. Vertical axis at left. The waveform repeats regularly: tall rectangular-like pulses with rounded tops, followed by smaller oscillations near the baseline before the next tall pulse.]

ex/ periodic signal  x(t) = 2 cos(20πt) - ⅓ cos(60πt)
+ ⅕ cos(100πt)      [big harmonic]

f = 10                    f = 30
[first harmonic]

Fo = gcd {10, 30, 50} = 10 Hz

3Fo = 30 Hz

5Fo = 50 Hz

{
0 otherwise
2 for k = ±1
-⅓ for k = ±3
⅕ for k = ±5
}


Non Periodic Signals
--------------------

When the frequencies have no harmonic relation to one another, the waveform becomes
non periodic.

[Diagram: graph of a nonperiodic waveform versus time. Horizontal axis labeled `t` with arrow to the right. Vertical axis at left. The waveform is irregular, with uneven peaks and valleys that do not repeat consistently.]

ex/ Non periodic signal  x(t) = 2 cos(20πt)
- ⅓ cos(20π√8 t) + ⅕ cos(20π√57 t)

f = 10√8 Hz                         f = 10√57 Hz
f = 10 Hz
up
f = 10 Hz

- no gcd.


2.4 Fourier Series
------------------

Jean Baptiste Fourier discovered that every periodic

[Truncated for analysis]

### Key points

- Periodic signals satisfy $x(t+T_0)=x(t)$ for all $t$
- The smallest repetition interval is the fundamental period
- Harmonically related frequencies are integer multiples of $F_0$
- Periodic synthesis: $x(t)=A_0+\sum_{k=1}^{N}A_k\cos(2\pi kF_0t+\phi_k)$
- The kth harmonic frequency is $f_k=kF_0$
- $A_0$ is the DC or zero-frequency component
- The fundamental frequency is $F_0=\gcd\{f_k\}$
- Non-harmonically related frequencies produce a nonperiodic waveform

### Related topics

- [[spectrum-representation-of-sums-of-sinusoids|Spectrum Representation of Sums of Sinusoids]]
- [[fourier-series-coefficients-and-line-spectra|Fourier Series Coefficients and Line Spectra]]
- [[sinusoidal-amplitude-modulation|Sinusoidal Amplitude Modulation]]

### Relationships

- related: [[spectrum-representation-of-sums-of-sinusoids|Spectrum Representation of Sums of Sinusoids]]
