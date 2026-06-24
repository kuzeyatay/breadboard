---
title: "Fourier Transform of a Constant Signal"
date: "2026-04-26T07:24:06.018Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "997203-english"
source_file: "997203_English.pdf"
locations: ["Page 5"]
related: ["fourier-domain-representation", "square-wave-decomposition-and-symmetry", "cosine-and-sine-frequency-representations"]
tags: ["fourier-transform", "constant", "delta-function", "zero-frequency", "dc-component", "line-codes"]
source_images: ["/communication-1/assets/997203-english-page-005.png"]
---

## Fourier Transform of a Constant Signal

Source: [[997203-english|Decibels, Fourier Representation, Digital Sampling, and Nyquist Reconstruction]]

Locations: Page 5

The lecture gives a key Fourier-transform result: a constant signal in time transforms into a delta function at zero frequency. The lecturer asks for the Fourier transform of a constant $A$ and identifies it as a delta function located at frequency zero. The reasoning is that a constant is equivalent to an Euler function with $\omega_0=0$, leaving only the constant value. In physical terms, a constant voltage over all time contains energy but has no time variation, so all of its spectral content is at zero frequency. This zero-frequency component is also called a DC component. The lecture states that this language will recur later when discussing line codes and their spectral behavior, where a DC component implies a delta at zero frequency.

### Source snapshots

![997203_English Page 5](/communication-1/assets/997203-english-page-005.png)

### Page-grounded details

#### Page 5

positive part is canceled out by the negative part. So this second harmonic does
not contribute to the total waveform. And this true for all the even harmonics. So
the fourth harmonic, we have the same behavior. While the other harmonics all have
contributions, the first one has the biggest contribution, but as you go on with
harmonics, you'll see that the third harmonic will have part of it, like Mark drew
very well, I ran out of colors, very disappointing, they only have two colors in
this room, okay, it doesn't matter, green. So this is Mark's amazing drawing. So
this one and this one are canceling out, but this part still contributes. So the
third harmonic actually does contribute. And you can do the, but it's of course
smaller than the original one, so that's how it goes. One last question about
Fourier. We talked about the Fourier system of Euler function, the exponential,
which ended up being a delta function with the frequency displacement. You remember
that was done Tuesday. And a simple question will be, what is the Fourier transform
of the constant A? Yes, a delta function, at which frequency? Yes, at zero. So this
is nothing more, nothing less than A. If the frequency i

[Truncated for analysis]

### Key points

- The Fourier transform of a constant $A$ is a delta function at zero frequency.
- A constant can be viewed as an Euler function with $\omega_0=0$.
- A constant signal has no changes in time, so it has zero-frequency content.
- A constant voltage over all time implies energy in the spectrum despite no oscillation.
- A zero-frequency spectral component is called a DC component.
- Line-code spectral behavior will later use the idea that a DC component appears as a delta at zero.

### Related topics

- [[fourier-domain-representation|Fourier Domain Representation]]
- [[square-wave-decomposition-and-symmetry|Square Wave Harmonic Decomposition]]
- [[cosine-and-sine-frequency-representations|Cosine and Sine Frequency Representations]]

### Relationships

- example-of: [[fourier-domain-representation|Fourier Domain Representation]]
