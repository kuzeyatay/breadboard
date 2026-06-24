---
title: "Cosine and Sine Frequency Representations"
date: "2026-04-26T07:24:06.018Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "997203-english"
source_file: "997203_English.pdf"
locations: ["Page 4", "Page 9"]
related: ["fourier-domain-representation", "orthogonal-bases-for-signal-representation", "ideal-sampling-as-multiplication-by-a-delta-train"]
tags: ["cosine", "sine", "euler-function", "frequency-domain", "real-signals"]
source_images: ["/communication-1/assets/997203-english-page-004.png", "/communication-1/assets/997203-english-page-009.png"]
---

## Cosine and Sine Frequency Representations

Source: [[997203-english|Decibels, Fourier Representation, Digital Sampling, and Nyquist Reconstruction]]

Locations: Page 4, Page 9

The lecture notes a specific frequency-domain fact about cosine and sine functions that students are expected to remember. A cosine has two frequency-domain components symmetrically placed on both sides of zero frequency. A sine also has two components, but one is positive and one is negative in the frequency-domain representation. The lecturer connects this to Euler-function representations and says the graphs were discussed in the previous lecture, though one graph may have been missed. This fact is important for exam-style reasoning and for later material in the same lecture. It also supports the broader idea that real time-domain signals have symmetric spectra, a point later repeated during the sampling derivation.

### Source snapshots

![997203_English Page 4](/communication-1/assets/997203-english-page-004.png)

![997203_English Page 9](/communication-1/assets/997203-english-page-009.png)

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

- A cosine is represented by two symmetric frequency-domain components.
- A sine has one positive and one negative component in the frequency-domain representation.
- The representation follows from Euler-function decomposition.
- The lecturer identifies this as one of the few facts students should remember directly.
- The fact is relevant for an exam question discussed later in the lecture.
- The idea connects to the symmetry of spectra for real signals.

### Related topics

- [[fourier-domain-representation|Fourier Domain Representation]]
- [[orthogonal-bases-for-signal-representation|Orthogonal Bases for Signal Representation]]
- [[ideal-sampling-as-multiplication-by-a-delta-train|Ideal Sampling as Multiplication by a Delta Train]]

### Relationships

- part-of: [[fourier-domain-representation|Fourier Domain Representation]]
