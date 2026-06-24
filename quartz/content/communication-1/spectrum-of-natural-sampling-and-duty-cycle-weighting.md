---
title: "Spectrum of Natural Sampling and Duty-Cycle Weighting"
date: "2026-04-25T10:25:58.869Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "communications-1-coursereader"
source_file: "Communications_1_CourseReader.pdf"
locations: ["Page 36", "Page 37"]
related: ["natural-sampling-in-pulse-amplitude-modulation", "flat-top-sampling-and-aperture-effect", "aliasing-and-nyquist-sampling-criterion"]
tags: ["natural-sampling", "fourier-series", "sinc", "duty-cycle", "sampling-spectrum", "pulse-amplitude-modulation", "final-topic"]
source_images: ["/communication-1/assets/communications-1-coursereader-page-036-2.png", "/communication-1/assets/communications-1-coursereader-page-037-2.png"]
---

## Spectrum of Natural Sampling and Duty-Cycle Weighting

Source: [[communications-1-coursereader|Communications 1 Course Reader - Sampling, PAM, PCM, and Noise]]

Locations: Page 36, Page 37

The spectrum of natural sampling is derived by expressing the rectangular pulse train $x_g(t)$ as a Fourier series and then using multiplication-convolution duality. Because $x_g(t)$ is periodic, it can be written as $\sum_{n=-\infty}^{\infty} c_n e^{jn\omega_s t}$, where $\omega_s = 2\pi f_s$. The Fourier series coefficients are derived as $c_n = \frac{\tau}{T_s} \operatorname{sinc}\!\left(n\frac{\tau}{T_s}\right)$, showing that the harmonics of the pulse train are weighted by a sinc envelope. In the frequency domain this gives $$X_g(f)=\sum_{n=-\infty}^{\infty} \frac{\tau}{T_s}\operatorname{sinc}\!\left(n\frac{\tau}{T_s}\right)\delta(f-nf_s).$$ Convolving the input spectrum $A(f)$ with this line spectrum produces repeated copies of $A(f)$ centered at multiples of $f_s$, each scaled by the same sinc weighting. The compact result is $$S_g(f)= d\sum_{n=-\infty}^{\infty} \operatorname{sinc}(nd)A(f-nf_s),$$ where $d=\tau/T_s$. The section highlights that natural sampling reproduces the replication pattern of sampling theory, but now each spectral replica is weighted by the Fourier transform of the gating waveform. The first zero of the sinc envelope occurs at $f = 1/\tau$, setting an absolute null bandwidth characteristic.

### Source snapshots

![Communications_1_CourseReader Page 36](/communication-1/assets/communications-1-coursereader-page-036-2.png)

![Communications_1_CourseReader Page 37](/communication-1/assets/communications-1-coursereader-page-037-2.png)

### Page-grounded details

#### Page 36

where τ is the pulse width. Now since xg(t) is periodic, the Fourier series expansion is given
by
xg(t) =
∞	X
n=-∞
cnejnωst =
∞	X
k=-∞
Π( t - kTs
τ ) (47)
where ωs = 2πfs is the sampling frequency and cn are the fourier series coefficients. To find
the coefficients we have
cn = 1
Ts
Z
T s
s(t)e-jnωstdt = 1
Ts
Z τ
2
- τ
2
e-jnωstdt = τ
Ts
sinc(n * τ
Ts
) (48)
Furthermore, Xg(f ) can be expressed as follows (using the fact that multiplication by ej2πfst
in time-domain is a shift in frequency domain δ(f - nfs))
Xg(f ) = F(
∞	X
n=-∞
cnejnωst) =
∞	X
n=-∞
cnδ(f - nfs) (49)
Replacing cn on Eq. (49) with that found on Eq. (48) yields the final spectrum of
Xg(f )
Xg(f ) =
∞	X
n=-∞
τ
Ts
sinc(n * τ
Ts
)δ(f - nfs) (50)
The output sampled signal sg(t) can be expressed as
sg(t) = a(t)xg(t) = a(t) *
∞	X
k=-∞
Π( t - kTs
τ ) (51)
Finally, the spectrum of the natural sampled output signal Sg(f ) can be derived using the
fact that multiplication in the time domain is convolution in the frequency domain as
Sg(f ) = F[sg(t)] = F[a(t)xg(t)] = A(f ) ∗ Xg(f ) (52)
Placing Eq. (50) in Eq. (52) we finally get the spectrum of Sg(f )
Sg(f ) = A(f ) ∗
∞	X
n=-∞
τ
Ts
sinc(n * τ
Ts
)δ(f - nfs) =
∞	X
n=-∞
τ
Ts
sin

[Truncated for analysis]

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

### Key points

- The pulse train $x_g(t)$ is expanded as a Fourier series because it is periodic.
- The coefficients are $c_n = \frac{\tau}{T_s}\operatorname{sinc}\!\left(n\frac{\tau}{T_s}\right)$.
- The pulse-train spectrum is a weighted impulse train in frequency.
- The sampled spectrum is repeated copies of $A(f)$ shifted by multiples of $f_s$.
- Each replica is scaled by a sinc envelope set by the duty cycle.
- The final form is $S_g(f)= d\sum_n \operatorname{sinc}(nd)A(f-nf_s)$.
- The first zero of the weighting envelope occurs at $f=1/\tau$.

### Related topics

- [[natural-sampling-in-pulse-amplitude-modulation|Natural Sampling in Pulse Amplitude Modulation]]
- [[flat-top-sampling-and-aperture-effect|Flat-Top Sampling and Aperture Effect]]
- [[aliasing-and-nyquist-sampling-criterion|Aliasing and Nyquist Sampling Criterion]]

### Relationships

- part-of: [[natural-sampling-in-pulse-amplitude-modulation|Natural Sampling in Pulse Amplitude Modulation]]
- related: [[aliasing-and-nyquist-sampling-criterion|Aliasing and Nyquist Sampling Criterion]]
