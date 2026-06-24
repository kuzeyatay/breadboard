---
title: "Ideal Sampling as Multiplication by a Delta Train"
date: "2026-04-26T07:24:06.018Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "997203-english"
source_file: "997203_English.pdf"
locations: ["Page 8", "Page 9"]
related: ["aliasing-and-nyquist-sampling-criterion", "fourier-domain-representation", "spectral-replication-from-sampling", "time-frequency-multiplication-and-convolution-duality"]
tags: ["sampling", "delta-function", "sampling-function", "sampling-period", "sampling-frequency", "a-t", "s-t"]
source_images: ["/communication-1/assets/997203-english-page-008.png", "/communication-1/assets/997203-english-page-009.png"]
---

## Ideal Sampling as Multiplication by a Delta Train

Source: [[997203-english|Decibels, Fourier Representation, Digital Sampling, and Nyquist Reconstruction]]

Locations: Page 8, Page 9

The lecture formalizes ideal sampling mathematically. The sampled signal $s(t)$ is the product of the original continuous-time signal $a(t)$ and a sampling function $x(t)$. The sampling function selects values at equally spaced sampling instants separated by the sampling period $T_s$, where $T_s=1/f_s$. Mathematically, $x(t)$ is written as an infinite series of delta functions. Multiplying $a(t)$ by this delta train produces a sampled signal containing discrete values such as $a(T_s)$, $a(2T_s)$, and $a(3T_s)$. This idealized form represents samples as impulses with amplitudes equal to the original signal values at the sample times. The model is used to derive what sampling does in the frequency domain.

### Source snapshots

![997203_English Page 8](/communication-1/assets/997203-english-page-008.png)

![997203_English Page 9](/communication-1/assets/997203-english-page-009.png)

### Page-grounded details

#### Page 8

If I want to sample a signal, I'm gonna sample it. I'll get the samples. And the
first question is, how close do I need to put these sampling points? Yes. We said
sampling frequency needs to be at least twice the highest frequency of the wave.
Thank you. So this is something you've learned. It's called the Nyquist criteria,
right? If you want to sample a signal, you need to sample at least twice the
frequency of the signal. So this signal, let's assume for the sake of the
discussion that the highest frequency in this wave is 100 hertz. So somewhere, if
I'll do a Fourier transform, because this is a not periodic signal, if I do Fourier
transform of the signal and I look at the spectrum I get, I will see that spectrum,
there's a spectrum for this. So if I draw A of F, this is the A of F is the Fourier
transform of this. I will see something. And here, this is 100 hertz. It ends.
There's nothing more. Okay, that's the spectrum of A of T. It's called A of F and
it has a finite spectrum. So there is a somewhere, a wave at 100 hertz, which is
included in this. It needs to be represented. It's part of the signal, this is 100
hertz, so this will be 10 milliseconds. So what does it mean sam

[Truncated for analysis]

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

### Key points

- The sampled signal is modeled as $s(t)=a(t)x(t)$.
- $a(t)$ is the original continuous-time signal.
- $x(t)$ is the sampling function.
- The sample spacing is the sampling period $T_s=1/f_s$.
- $x(t)$ is represented as an infinite series of delta functions.
- The sampled signal contains values such as $a(T_s)$, $a(2T_s)$, and $a(3T_s)$ at the sampling instants.

### Related topics

- [[aliasing-and-nyquist-sampling-criterion|Nyquist Criterion]]
- [[fourier-domain-representation|Fourier Domain Representation]]
- [[spectral-replication-from-sampling|Spectral Replication from Sampling]]
- [[time-frequency-multiplication-and-convolution-duality|Time-Frequency Multiplication and Convolution Duality]]

### Relationships

- depends-on: [[time-frequency-multiplication-and-convolution-duality|Time-Frequency Multiplication and Convolution Duality]]
