---
title: "Time-Frequency Multiplication and Convolution Duality"
date: "2026-04-26T07:24:06.018Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "997203-english"
source_file: "997203_English.pdf"
locations: ["Page 9"]
related: ["ideal-sampling-as-multiplication-by-a-delta-train", "spectral-replication-from-sampling", "fourier-domain-representation"]
tags: ["multiplication", "convolution", "frequency-domain", "time-domain", "linear-time-invariant-systems", "fourier-transform"]
source_images: ["/communication-1/assets/997203-english-page-009.png"]
---

## Time-Frequency Multiplication and Convolution Duality

Source: [[997203-english|Decibels, Fourier Representation, Digital Sampling, and Nyquist Reconstruction]]

Locations: Page 9

The sampling derivation relies on a Fourier-domain duality: multiplication in the time domain corresponds to convolution in the frequency domain, and convolution in the time domain corresponds to multiplication in the frequency domain. Since ideal sampling is modeled as $s(t)=a(t)x(t)$, the Fourier transform $S(f)$ is obtained by convolving $A(f)$ with $X(f)$. The lecture reminds students of linear time-invariant system analysis: if an input $x(t)$ passes through a system with impulse response $h(t)$, then $y(t)=x(t)*h(t)$ in time, while in frequency domain $Y(f)=X(f)H(f)$. The lecture then applies the reverse direction of the same principle to sampling. This duality explains why multiplying a signal by a sampling train in time creates repeated spectral copies in frequency.

### Source snapshots

![997203_English Page 9](/communication-1/assets/997203-english-page-009.png)

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

### Key points

- Multiplication in time corresponds to convolution in frequency.
- Convolution in time corresponds to multiplication in frequency.
- Because $s(t)=a(t)x(t)$, the spectrum $S(f)$ is based on convolution of $A(f)$ and $X(f)$.
- For a linear time-invariant system, $y(t)=x(t)*h(t)$.
- In the frequency domain for that system, $Y(f)=X(f)H(f)$.
- The sampling derivation uses the reverse direction of the same Fourier duality.

### Related topics

- [[ideal-sampling-as-multiplication-by-a-delta-train|Ideal Sampling as Multiplication by a Delta Train]]
- [[spectral-replication-from-sampling|Spectral Replication from Sampling]]
- [[fourier-domain-representation|Fourier Domain Representation]]

