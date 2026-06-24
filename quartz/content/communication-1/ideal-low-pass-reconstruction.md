---
title: "Ideal Low-Pass Reconstruction"
date: "2026-04-26T07:24:06.018Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "997203-english"
source_file: "997203_English.pdf"
locations: ["Page 10"]
related: ["aliasing-and-nyquist-sampling-criterion", "spectral-replication-from-sampling", "under-sampling-and-spectral-overlap"]
tags: ["low-pass-filter", "reconstruction", "nyquist-frequency", "a-f", "s-f", "h-f", "rectangle-filter"]
source_images: ["/communication-1/assets/997203-english-page-010.png"]
---

## Ideal Low-Pass Reconstruction

Source: [[997203-english|Decibels, Fourier Representation, Digital Sampling, and Nyquist Reconstruction]]

Locations: Page 10

The lecture explains how perfect reconstruction is possible after ideal sampling if the Nyquist condition is satisfied. Since sampling creates periodic copies of the original spectrum, reconstruction can be achieved by selecting the central copy around zero frequency. The lecturer proposes an ideal low-pass filter with a rectangular frequency response $H(f)$ that passes only the central copy of $S(f)$ and rejects all other spectral repetitions. If the spectral copies do not overlap, this filtering retrieves $A(f)$, the spectrum of the original signal. Applying the inverse Fourier transform then recovers the original waveform exactly. The lecturer stresses that this result is exact under ideal assumptions: sampling at least at the Nyquist frequency and applying a perfect rectangular low-pass filter. In practice, perfect filters do not exist, but the theorem explains why sampling can preserve all information under the right conditions.

### Source snapshots

![997203_English Page 10](/communication-1/assets/997203-english-page-010.png)

### Page-grounded details

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

- The sampled signal has a periodic spectrum made of copies of the original spectrum.
- Reconstruction can use a low-pass filter to isolate the central copy around zero frequency.
- An ideal rectangular low-pass filter is used in the explanation.
- If the central copy is isolated, the output spectrum is $A(f)$.
- Recovering $A(f)$ means recovering the original signal exactly under ideal conditions.
- Perfect reconstruction requires sampling at least at the Nyquist frequency and ideal filtering.

### Related topics

- [[aliasing-and-nyquist-sampling-criterion|Nyquist Criterion]]
- [[spectral-replication-from-sampling|Spectral Replication from Sampling]]
- [[under-sampling-and-spectral-overlap|Under-Sampling and Spectral Overlap]]

### Relationships

- depends-on: [[spectral-replication-from-sampling|Spectral Replication from Sampling]]
- depends-on: [[aliasing-and-nyquist-sampling-criterion|Nyquist Criterion]]
- contrasts-with: [[under-sampling-and-spectral-overlap|Under-Sampling and Spectral Overlap]]
