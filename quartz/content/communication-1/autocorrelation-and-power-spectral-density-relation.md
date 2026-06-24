---
title: "Autocorrelation and Power Spectral Density Relation"
date: "2026-04-25T10:25:58.869Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "communications-1-coursereader"
source_file: "Communications_1_CourseReader.pdf"
locations: ["Page 148", "Page 149", "Section: 14 Appendix C: Autocorrelation and PSD relation"]
related: ["working-with-decibels-for-power-gain-and-snr", "physical-channel-equation-sheet"]
tags: ["autocorrelation", "power-spectral-density", "fourier-transform", "signal-processing", "final-topic"]
source_images: ["/communication-1/assets/communications-1-coursereader-page-148-2.png", "/communication-1/assets/communications-1-coursereader-page-149-2.png"]
---

## Autocorrelation and Power Spectral Density Relation

Source: [[communications-1-coursereader|Communications 1 Course Reader - Sampling, PAM, PCM, and Noise]]

Locations: Page 148, Page 149, Section: 14 Appendix C: Autocorrelation and PSD relation

Appendix C derives the standard result that a signal's power spectral density is the Fourier transform of its autocorrelation function. The derivation starts by defining the autocorrelation of $w(t)$ as a long-term time average of the product $w(t)w(t+\tau)$. The Fourier transform of this autocorrelation function is then taken, converting the dependence on delay into a frequency-domain quantity. After substituting the autocorrelation definition into the transform, the order of limits and integrals is interchanged under regularity assumptions. The text notes that for a real signal, $w^*(t)=w(t)$, and introduces the Fourier transform $W(\omega)$. Using Fourier-transform properties and the convolution viewpoint, the derivation reaches a form proportional to $\frac{1}{T}|W(\omega)|^2$. Taking the limit as $T\to\infty$ defines the power spectral density. The final conclusion is the Wiener-Khinchin style result: $$P_w(f)=\mathcal{F}[R_{ww}(\tau)].$$

### Source snapshots

![Communications_1_CourseReader Page 148](/communication-1/assets/communications-1-coursereader-page-148-2.png)

![Communications_1_CourseReader Page 149](/communication-1/assets/communications-1-coursereader-page-149-2.png)

### Page-grounded details

#### Page 148

14 Appendix C: Autocorrelation and PSD relation
Step 1: Definition of the autocorrelation function Rww(τ )
Rww(τ ) = lim
T ->∞
1
T
Z T /2
-T /2
w(t) w(t + τ ) dt. (208)
This expression calculates how similar the signal w(t) is to a delayed version of itself w(t+τ ),
averaged over an interval of length T . As T goes to infinity, it represents the long-term
average.
Step 2: Taking the Fourier transform of Rww(τ )
F Rww(τ ) =
Z ∞
-∞
Rww(τ ) e-jωτ dτ. (209)
Here, the Fourier transform converts the autocorrelation function Rww(τ ) from the time
(delay) domain into the frequency domain.
Step 3: Substituting the definition of Rww(τ ) into the transform
F Rww(τ ) =
Z ∞
-∞
lim
T ->∞
1
T
Z T /2
-T /2
w(t) w(t + τ ) dt
!
e-jωτ dτ. (210)
The limit limT ->∞ appears because the true autocorrelation function is defined in the limit
of large T . Inside, there is a product w(t)w(t + τ ) integrated over -T /2 to T /2.
Step 4: Interchanging limits and integrals (assuming conditions for valid inter-
change)
F Rww(τ ) = lim
T ->∞
1
T
Z T /2
-T /2
Z ∞
-∞
w(t) w(t + τ ) e-jωτ dτ dt. (211)
Under certain regularity conditions (such as absolute integrability), it is possible to exchange
the order of i

[Truncated for analysis]

#### Page 149

This final step states that the power spectral density Pw(f ) is the limiting form of 1
T |W (f )|2
as T approaches infinity. It shows how power is distributed over frequency for the signal
w(t).
By looking at the last two equations, the relation can be clearly made that Pw(f ) =
F [Rww(τ )].
145

### Key points

- Autocorrelation is defined as a long-term average similarity between a signal and a delayed version of itself.
- The Fourier transform maps autocorrelation from delay domain to frequency domain.
- The derivation substitutes the autocorrelation definition into the transform integral.
- Under suitable conditions, the limit and integrals can be interchanged.
- For a real signal, the complex conjugate simplifies as $w^*(t)=w(t)$.
- The transformed autocorrelation becomes proportional to $\frac{1}{T}|W(\omega)|^2$.
- In the limit, power spectral density equals the Fourier transform of autocorrelation.

### Related topics

- [[working-with-decibels-for-power-gain-and-snr|Working with Decibels for Power, Gain, and SNR]]
- [[physical-channel-equation-sheet|Physical Channel Equation Sheet]]

### Relationships

- related: [[physical-channel-equation-sheet|Physical Channel Equation Sheet]]
