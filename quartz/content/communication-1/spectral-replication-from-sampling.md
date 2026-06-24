---
title: "Spectral Replication from Sampling"
date: "2026-04-26T07:24:06.018Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "997203-english"
source_file: "997203_English.pdf"
locations: ["Page 9", "Page 10"]
related: ["ideal-sampling-as-multiplication-by-a-delta-train", "time-frequency-multiplication-and-convolution-duality", "under-sampling-and-spectral-overlap", "ideal-low-pass-reconstruction"]
tags: ["sampling", "delta-function", "spectrum", "a-f", "s-f", "f-s", "convolution"]
source_images: ["/communication-1/assets/997203-english-page-009.png", "/communication-1/assets/997203-english-page-010.png"]
---

## Spectral Replication from Sampling

Source: [[997203-english|Decibels, Fourier Representation, Digital Sampling, and Nyquist Reconstruction]]

Locations: Page 9, Page 10

The lecture derives the frequency-domain effect of ideal sampling. The Fourier transform of an infinite delta train in time is also an infinite series of delta functions in frequency, with spacing related to the sampling frequency $f_s$. The lecturer writes this frequency-domain sampling function as delta functions at frequencies such as $f-nf_s$. Convolving the original spectrum $A(f)$ with shifted delta functions creates shifted copies of $A(f)$. Therefore, the spectrum of the sampled signal $S(f)$ is an infinite sum of repeated versions of the original spectrum, centered at multiples of the sampling frequency. The lecturer describes this as occupying the spectrum from negative infinity to positive infinity with copies of the original signal spectrum. This spectral replication is the foundation for understanding both Nyquist sampling and aliasing.

### Source snapshots

![997203_English Page 9](/communication-1/assets/997203-english-page-009.png)

![997203_English Page 10](/communication-1/assets/997203-english-page-010.png)

### Page-grounded details

#### Page 9

at these sampling moments, and this is the ideal sample signal. It has the values,
so it has all these values, these are all a and t, so this is a, t, s, and this
would be a, two t, s, and this one would be a, three t, s, and so forth. These are
discrete values. They are, as we decided, fast enough, we sample fast enough,
because that means that if there is a sine wave hiding here which has a frequency,
maximum frequency of 100 hertz, we sum it at least twice in that period so we can
reconstruct a sine function. This is the time representation. What happens in
frequency? Need to make sure it's not escaping too far, but there is no way of
capturing it. In order to understand what happens in frequency, I need to take s of
t and do Fourier transform. So s of f is the Fourier transform of s of t. S of f
is, and s of t is a multiplication of two functions, of a and t, and x, t. If we
have multiplication in the time domain, we will have convolution in the frequency
domain, okay? We talked about it before when you said, remember we talked about
linear time invariant systems, all right, just a quick reminder. We said if x, t is
the input, and I have a transfer function h of t, and I want t

[Truncated for analysis]

#### Page 10

f zero. How best to do it? I don't know how best to do it. It's a mathematical fact
that when you convolute something with a displaced delta function, you get the
function centered around that new frequency. You can look at it from how you
integrate this and what does it mean to do the integration. I don't wanna spend too
much time on it. It's just pure mathematics, but this is an important outcome of
this calculation because it means, and that's important. So I apologize if I skip
the math here, but it is the result of convoluting with the delta function, this is
the space. And if you take my word for it for a minute, it means that what we have
here is an infinite sum. So this is the spectrum of the sample signal. So the
spectrum of the sample signals is an infinite sum of the original spectra of our
signal, repeated again and again and again in the spectral domain. Basically we're
occupying, for a better word, the entire spectrum from minus infinity to plus
infinity with copies of the original signal. You can also draw this and for drawing
it, I will dramatically simplify the spectrum A of F because it's difficult to draw
these wiggly lines every time. So if A of F spectrum looks

[Truncated for analysis]

### Key points

- The Fourier transform of an infinite delta train in time is an infinite delta train in frequency.
- The frequency-domain delta functions are spaced by the sampling frequency $f_s$.
- The sampling spectrum can be written using terms such as $\delta(f-nf_s)$.
- Convolving $A(f)$ with a shifted delta function produces a shifted copy of $A(f)$.
- $S(f)$ is an infinite sum of repeated copies of the original spectrum.
- These spectral copies extend from negative infinity to positive infinity.

### Related topics

- [[ideal-sampling-as-multiplication-by-a-delta-train|Ideal Sampling as Multiplication by a Delta Train]]
- [[time-frequency-multiplication-and-convolution-duality|Time-Frequency Multiplication and Convolution Duality]]
- [[under-sampling-and-spectral-overlap|Under-Sampling and Spectral Overlap]]
- [[ideal-low-pass-reconstruction|Ideal Low-Pass Reconstruction]]

### Relationships

- derives-from: [[ideal-sampling-as-multiplication-by-a-delta-train|Ideal Sampling as Multiplication by a Delta Train]]
- depends-on: [[time-frequency-multiplication-and-convolution-duality|Time-Frequency Multiplication and Convolution Duality]]
