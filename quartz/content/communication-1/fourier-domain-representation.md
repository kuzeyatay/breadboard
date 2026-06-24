---
title: "Fourier Domain Representation"
date: "2026-04-26T07:24:06.018Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "997203-english"
source_file: "997203_English.pdf"
locations: ["Page 4"]
related: ["orthogonal-bases-for-signal-representation", "square-wave-decomposition-and-symmetry", "fourier-transform-of-a-constant-signal", "ideal-sampling-as-multiplication-by-a-delta-train"]
tags: ["fourier-transform", "inverse-fourier-transform", "frequency-domain", "time-domain", "c-n", "sine", "cosine"]
source_images: ["/communication-1/assets/997203-english-page-004.png"]
---

## Fourier Domain Representation

Source: [[997203-english|Decibels, Fourier Representation, Digital Sampling, and Nyquist Reconstruction]]

Locations: Page 4

The lecture explains Fourier representation as a way to describe the same signal using a different set of basis functions. A square-like signal in the time domain can be expressed in the frequency domain by determining how much of each sine or cosine basis function is present. Each component has a frequency and an amplitude or coefficient, such as coefficients $C_N$ computed by integrating against basis functions. The lecturer emphasizes that the time-domain and frequency-domain descriptions represent the same signal, not two different signals. The Fourier transform is the operation that moves from time domain to frequency domain, while the inverse Fourier transform moves from frequency domain back to time domain. This ability to go back and forth between domains becomes central for understanding sampling and reconstruction later in the lecture.

### Source snapshots

![997203_English Page 4](/communication-1/assets/997203-english-page-004.png)

### Page-grounded details

#### Page 4

in the time domain. So that's in time and it's just an amplitude as X is always
important. I'm kind of focusing on that. I will also focus in grading on that. I'm
always want to have X is labeled, sorry, already mentioning that. So these are
expressed in the time domain and what you can do is you can also express in a
frequency domain and one of the way of visualizing that is if you use a set of
other base vectors. So in this case, you use a sine or cosine functions. You are
able to express these by defining their ratio within this signal. So if you would
draw a function and then you calculate for this function, what's the path that it
is represented in the initial signal. Then you go for a higher base frequency. And
now I'm able to draw that. Yeah, not the best drawing skills. And based on these
different components, so each of them has a representation in the frequency domain.
So you have in the frequencies, you have also an amplitude which is or the
coefficient actually and the frequency and the first one that you used has a
certain base frequencies, W zero for example. And then you know, okay, this is the
component that is representing that first to represent the initial signal

[Truncated for analysis]

### Key points

- A time-domain signal can be represented in the frequency domain using sine and cosine basis functions.
- Each frequency component has a frequency and an amplitude or coefficient.
- Coefficients such as $C_N$ are obtained using integrals over basis functions.
- The same signal can be represented in different domains using different basis functions.
- The Fourier transform maps from time domain to frequency domain.
- The inverse Fourier transform maps from frequency domain back to time domain.

### Related topics

- [[orthogonal-bases-for-signal-representation|Orthogonal Bases for Signal Representation]]
- [[square-wave-decomposition-and-symmetry|Square Wave Harmonic Decomposition]]
- [[fourier-transform-of-a-constant-signal|Fourier Transform of a Constant Signal]]
- [[ideal-sampling-as-multiplication-by-a-delta-train|Ideal Sampling as Multiplication by a Delta Train]]

### Relationships

- applies-to: [[square-wave-decomposition-and-symmetry|Square Wave Harmonic Decomposition]]
