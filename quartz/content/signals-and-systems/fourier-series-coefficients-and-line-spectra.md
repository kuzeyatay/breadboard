---
title: "Fourier Series Coefficients and Line Spectra"
date: "2026-04-30T16:26:39.261Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "signals-and-systems-full-notes"
source_file: "Signals and Systems full notes.pdf"
locations: ["Page 13", "Page 14"]
related: ["periodic-signals-and-harmonics", "conjugate-symmetry-and-line-spectra", "fourier-series-time-shift-and-scaling"]
tags: ["fourier-series", "fourier-coefficients", "dc-component", "line-spectrum", "jean-baptiste-fourier", "square-wave"]
source_images: ["/signals-and-systems/assets/signals-and-systems-full-notes-page-013.png", "/signals-and-systems/assets/signals-and-systems-full-notes-page-014.png"]
---

## Fourier Series Coefficients and Line Spectra

Source: [[signals-and-systems-full-notes|Signals and Systems Full Notes: Sinusoids, Spectra, Sampling, Aliasing, and FIR Filters]]

Locations: Page 13, Page 14

Fourier series generalize harmonic synthesis by stating that every periodic signal can be synthesized as a sum of harmonically related sinusoids or complex exponentials. The notes attribute this discovery to Jean Baptiste Fourier and call the process Fourier synthesis, summation, or Fourier Series. The complex Fourier series is written using coefficients $a_k$ multiplying harmonics of the fundamental frequency: $x(t)=\sum_{k=-\infty}^{\infty}a_ke^{j(2\pi/T_0)kt}$, with a separate emphasis on $a_0$ as the average or DC value. The Fourier coefficient integral is $a_k=\frac{1}{T_0}\int_{T_0}x(t)e^{-j(2\pi/T_0)kt}\,dt$ for nonzero integer harmonics, and $a_0=\frac{1}{T_0}\int_0^{T_0}x(t)\,dt$. In the square-wave example with period $T_0=2\text{ s}$, the signal is $1$ on $-1/2<t<1/2$ and $-1$ on $1/2<t<3/2$, giving $a_0=0$. The derivation leads to nonzero coefficients only for odd harmonics, and the line spectrum shows decreasing stems at positive and negative harmonics.

### Source snapshots

![Signals and Systems full notes Page 13](/signals-and-systems/assets/signals-and-systems-full-notes-page-013.png)

![Signals and Systems full notes Page 14](/signals-and-systems/assets/signals-and-systems-full-notes-page-014.png)

### Page-grounded details

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

#### Page 14

The Fourier series coefficient for k=0 has a special interpretation as the
average value of the signal x(t), which is the DC component

a_0 = 1/T_0 ∫_0ᵀ^0 x(t) dt

[Diagram: square wave x(t) plotted versus t. Vertical axis labeled x(t), horizontal axis labeled t. The waveform is +1 from t = -1/2 to t = 1/2, then -1 from t = 1/2 to t = 3/2, then +1 from t = 3/2 to t = 2. The levels +1 and -1 are marked on the vertical axis. The x-axis tick labels include -1/2, 1/2, 3/2, 2. A shaded/hatched rectangular region covers the positive portion between -1/2 and 1/2 and the negative portion between 1/2 and 3/2. A dashed sloping line appears inside the hatched region.]

given this block square wave, give line spectrum of this signal

solution: x(t) = { 1 for -1/2 < t < 1/2
                 -1 for 1/2 < t < 3/2

and period T_0 = 2s ~ The fourier series summation
states that

x(t) = a_0 + sumₖ₌₋∞^∞ aₖ * eʲ^2πᶠ^0ᵏᵗ

and aₖ = 1/T_0 ∫_0ᵀ^0 x(t)e⁻ʲ(2π/T_0)kt dt, and a_0 = 1/T_0 ∫_0ᵀ^0 x(t) dt.

first, lets begin with a_0:

a_0 = 1/2 ∫_0^2 x(t)dt.
= 1/2 ∫_0^3ᐟ^2 x(t)dt
= 1/2 ∫₋^1ᐟ^23ᐟ^2 x(t)dt = 1/2 [1 + (-1)] = 0
∴ a_0 = 0.

then find a formula for aₖ

aₖ = 1/T_0 ∫_0ᵀ^0 x(t)e⁻ʲ(2π/T_0)kt dt

= 1/2 (

[Truncated for analysis]

### Key points

- Fourier series synthesize periodic signals from harmonically related components
- The complex Fourier series uses coefficients $a_k$
- General form: $x(t)=\sum_{k=-\infty}^{\infty}a_ke^{j(2\pi/T_0)kt}$
- Coefficient integral: $a_k=\frac{1}{T_0}\int_{T_0}x(t)e^{-j(2\pi/T_0)kt}\,dt$
- $a_0$ is the average value or DC component
- $a_0=\frac{1}{T_0}\int_0^{T_0}x(t)\,dt$
- The square-wave example has $T_0=2\text{ s}$ and $a_0=0$
- The square-wave line spectrum has zero even harmonics

### Related topics

- [[periodic-signals-and-harmonics|Periodic Signals and Harmonics]]
- [[conjugate-symmetry-and-line-spectra|Conjugate Symmetry and Line Spectra]]
- [[fourier-series-time-shift-and-scaling|Fourier Series Time Shift and Scaling]]

### Relationships

- depends-on: [[periodic-signals-and-harmonics|Periodic Signals and Harmonics]]
