---
title: "Flat-Top Sampling and Aperture Effect"
date: "2026-04-25T10:25:58.869Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "communications-1-coursereader"
source_file: "Communications_1_CourseReader.pdf"
locations: ["Page 37", "Page 38"]
related: ["natural-sampling-in-pulse-amplitude-modulation", "spectrum-of-natural-sampling-and-duty-cycle-weighting", "pulse-code-modulation-and-quantization-process"]
tags: ["flat-top-sampling", "sample-and-hold", "aperture-effect", "sinc", "quantization", "pulse-amplitude-modulation", "final-topic"]
source_images: ["/communication-1/assets/communications-1-coursereader-page-037-2.png", "/communication-1/assets/communications-1-coursereader-page-038-2.png"]
---

## Flat-Top Sampling and Aperture Effect

Source: [[communications-1-coursereader|Communications 1 Course Reader - Sampling, PAM, PCM, and Noise]]

Locations: Page 37, Page 38

Flat-top sampling, also called sample-and-hold or instantaneous sampling, captures the value of the analog signal at each sampling instant $kT_s$ and then holds that value constant for the full pulse duration $\tau$. This creates a piecewise-constant pulse-amplitude-modulated waveform that is particularly suitable for analog-to-digital conversion, because each sample is a stable voltage that can be quantized. The text distinguishes this from natural sampling, where the pulse amplitude continues to vary during the gate interval. Mathematically, the signal is written as $$s_i(t)=\sum_{k=-\infty}^{\infty} a(kT_s)\Pi\!\left(\frac{t-kT_s}{\tau}\right).$$ Rewriting the expression as a convolution reveals that flat-top sampling equals ideal impulse sampling followed by convolution with a rectangular hold pulse. In frequency, this multiplies the ideal sampled spectrum by a sinc-shaped factor, yielding $$S_i(f)=\frac{1}{T_s}\,|d\operatorname{sinc}(\tau f)|\sum_{k=-\infty}^{\infty}|A(f-kf_s)|.$$ The practical implication is the aperture effect: high-frequency components may be attenuated by the sample-and-hold sinc response. The text suggests two mitigation strategies: reduce the pulse width $\tau$, or use an equalization filter with transfer function $1/H(f)$ to compensate for the flat-top response.

### Source snapshots

![Communications_1_CourseReader Page 37](/communication-1/assets/communications-1-coursereader-page-037-2.png)

![Communications_1_CourseReader Page 38](/communication-1/assets/communications-1-coursereader-page-038-2.png)

### Page-grounded details

#### Page 37

B	-B 	fs 	2fs 	3fs	-2fs 	-fs	-3fs
f
Absolute Null Bandwidth:
Figure 23: Analytical gating (natural sampling) spectrum for d = 1/3, fs = 3 Hz, assuming that
the analog signal A(f ) has a rectangular spectrum from -1 Hz to 1 Hz (B=1 Hz).
4.4 Flat-top sampling (or instantaneous sampling)
In flat-top sampling, the value of the analog signal is captured at the sampling instant kTs
and held constant for the duration of the sample pulse τ (it is hence often referred to as
sample and hold method). This concept is illustrated in Fig. 24
=
t
t
t
τ
Ts
(Sample-and-hold)
Ts
Figure 24: A input signal a(t) undergoing sample-and-hold to generate output flat-top sampled
signal si(t), illustrating the concept of flat-top (instantaneous) sampling
Unlike gated sampling, which results in a sampled signal with varying amplitude during
the sample time, Flat-top sampling produced a single voltage value for the duration of the
sampling pulse duration. This makes it a practical method since the fixed value can be easily
converted into a digital value (quantized) as will be shown in the following chapters.
4.4.1 Spectrum of flat-top sampling
The spectrum of flat-top sampling can be found more easily by explo

[Truncated for analysis]

#### Page 38

We can change si(t) to
si(t) =
∞	X
k=-∞
a(kTs)Π( t
τ ) ∗ δ(t - kTs) (56)
si(t) = Π( t
τ ) ∗ [a(t)
∞	X
k=-∞
δ(t - kTs)] (57)
By taking the Fourier transform of Eq. (57) we get
Si(f ) = F{si(t)} = dsinc(τ f )(F{a(t)
∞	X
k=-∞
δ(t - kTs)}) (58)
where d = τ
Ts , equal to the duty cycle of the sample pulse and the fact that F{Π( t
τ )} =
dsinc(τ f ). We can realize that a(t) P∞
k=-∞ δ(t-kTs) is identical to ideal impulse sampling,
so we can use the result of Eq. (37), to solve directly.
Si(f ) = F{si(t)} = dsinc(τ f )[ 1
Ts
∞	X
k=-∞
A(f - kfs)] (59)
Thus, finally, we have that the spectrum of flat-top sampling is given as:




Si(f ) = 1
Ts |dsinc(τ f )| P∞
k=-∞ |A(f - kfs)| 	(60)
From Eq. (61), we can see that the spectrum of flat-top sampling is a filtered spectrum
of ideal impulse sampling by a form of low-pass filter. The spectrum of flat-top sampling
is illustrated in Fig. 25. An important observation can be made from Fig. 25, that some
high-frequency components might be altered, due to the filtering effect of flat-top sampling.
This is known as aperture effect. This may be resolved by (i) narrowing the pulse width τ ,
(ii) by an equalization filter with transfer function 1
H(f

[Truncated for analysis]

### Key points

- Flat-top sampling captures $a(kT_s)$ and holds it constant for duration $\tau$.
- It is also called sample-and-hold or instantaneous sampling.
- This method is practical because constant sample values are easy to quantize.
- Its spectrum equals ideal sampled replicas filtered by a sinc factor.
- The final spectral form is $S_i(f)=\frac{1}{T_s}|d\operatorname{sinc}(\tau f)|\sum_k |A(f-kf_s)|$.
- High-frequency attenuation caused by the hold action is called aperture effect.
- Aperture effect can be reduced by using smaller $\tau$ or equalization.

### Related topics

- [[natural-sampling-in-pulse-amplitude-modulation|Natural Sampling in Pulse Amplitude Modulation]]
- [[spectrum-of-natural-sampling-and-duty-cycle-weighting|Spectrum of Natural Sampling and Duty-Cycle Weighting]]
- [[pulse-code-modulation-and-quantization-process|Pulse Code Modulation and Quantization Process]]

### Relationships

- contrasts-with: [[natural-sampling-in-pulse-amplitude-modulation|Natural Sampling in Pulse Amplitude Modulation]]
- applies-to: [[pulse-code-modulation-and-quantization-process|Pulse Code Modulation and Quantization Process]]
