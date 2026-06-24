---
title: "Discrete Spectrum and Sinc Envelope for Periodic Signals"
date: "2026-04-26T07:08:26.047Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "988929-english-3"
source_file: "988929_English-3.pdf"
locations: ["Page 11"]
related: ["period-fundamental-frequency-and-harmonics", "square-wave-decomposition-and-symmetry", "fourier-series-coefficients-from-orthogonal-projection"]
tags: ["discrete-spectrum", "sinc-function", "fourier-series", "harmonics", "euler-function"]
source_images: ["/communication-1/assets/988929-english-3-page-011.png"]
---

## Discrete Spectrum and Sinc Envelope for Periodic Signals

Source: [[988929-english-3|Communication 1 Course Introduction and Foundations of Digital Communication]]

Locations: Page 11

The lecture concludes this chunk by describing the frequency-domain appearance of a periodic waveform's Fourier series. Because the waveform is periodic in time, the frequencies needed to reconstruct it are discrete rather than continuous. Each discrete spectral line corresponds to a harmonic index $k$ and therefore to a frequency such as $\omega_0$, $3\omega_0$, and so on. In the square-wave-like example, the amplitudes of these coefficients are not uniform; instead they lie under an envelope described as the sinc function, written as $\sin(\pi x)/(\pi x)$. The instructor also notes the removable singularity at zero and explains using the Taylor-series idea that the value at zero is 1. This topic links coefficient patterns, periodicity, and the recognizable sinc envelope.

### Source snapshots

![988929_English-3 Page 11](/communication-1/assets/988929-english-3-page-011.png)

### Page-grounded details

#### Page 11

gonna use the frequency as we want.
Oh, something's burning a fire brigade Yeah, that's a joke Hopefully, I'll do the
term is burning You will tell us, huh? Okay, very good.
Okay, we're safe the rest can burn so if If my my pulses are faster if I want this
information faster shorter pulses because I want the information faster I will need
more frequency There is not Infinite frequency I can use it's for some application
It's actually something you pay for and some application something that it's just
difficult to generate so sometimes difficult but these base frequency this and of
course every in principle every harmonic of that frequency can potentially be part
of the way I Reconstruct the signal not always not for all signals.
They have different symmetries. For example, this wave as I drew it here And this
is the zero is an anti symmetric function It's a function.
It means that if I move the Zero line to here.
It looks like it looks almost like a sine function because it has This behavior
Around this this line, which is just a fixed value It really looks like a sine
function It does mean That if I try to build the series the composition of this I
will not find any cosine functio

[Truncated for analysis]

### Key points

- A periodic time-domain signal produces a discrete frequency-domain representation.
- Each Fourier coefficient corresponds to a harmonic frequency indexed by integer $k$.
- Positive and negative frequency components appear symmetrically.
- The harmonic amplitudes can be shaped by a sinc envelope.
- The sinc function is given as $\sin(\pi x)/(\pi x)$.
- At $x=0$, the sinc value is treated as 1 by the limiting argument.

### Related topics

- [[period-fundamental-frequency-and-harmonics|Period, Fundamental Frequency, and Harmonics]]
- [[square-wave-decomposition-and-symmetry|Square-Wave Decomposition and Symmetry]]
- [[fourier-series-coefficients-from-orthogonal-projection|Fourier Series Coefficients from Orthogonal Projection]]

### Relationships

- derives-from: [[square-wave-decomposition-and-symmetry|Square-Wave Decomposition and Symmetry]]
- depends-on: [[period-fundamental-frequency-and-harmonics|Period, Fundamental Frequency, and Harmonics]]
