---
title: "Folding Due to Under-Sampling"
date: "2026-04-30T16:26:39.261Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "signals-and-systems-full-notes"
source_file: "Signals and Systems full notes.pdf"
locations: ["Page 24"]
related: ["discrete-time-aliases-and-principal-frequency", "spectrum-view-of-sampling-and-reconstruction", "aliasing-problem-solving-with-multiple-sinusoids"]
tags: ["folding", "under-sampling", "aliasing", "phase", "principal-interval", "reconstruction"]
source_images: ["/signals-and-systems/assets/signals-and-systems-full-notes-page-024.png"]
---

## Folding Due to Under-Sampling

Source: [[signals-and-systems-full-notes|Signals and Systems Full Notes: Sinusoids, Spectra, Sampling, Aliasing, and FIR Filters]]

Locations: Page 24

Folding is a specific form of aliasing where a positive-frequency component in the principal interval originates from a negative-frequency component outside the interval, causing the reconstructed phase sign to change. The notes use a 100 Hz sinusoid sampled at $f_s=125$ Hz. The normalized frequency is $\hat{\omega}=2\pi(100/125)=8\pi/5=1.6\pi$, which lies outside the principal interval. The two components inside $\pm\pi$ appear at $\hat{\omega}=0.4\pi$, but the component at $+0.4\pi$ is an alias of the negative-frequency component at $-1.6\pi$. This is why the situation is called folding. The sequence is manipulated as $x[n]=\cos(-1.6\pi n+2\pi n+\pi/6)=\cos(-1.6\pi n+\pi/6)=\cos(1.6\pi n-\pi/6)$. When reconstructed, the result is $y(t)=\cos(2\pi100t-\pi/6)$, showing that folding changes the sign of the phase in the reconstructed analog signal.

### Source snapshots

![Signals and Systems full notes Page 24](/signals-and-systems/assets/signals-and-systems-full-notes-page-024.png)

### Page-grounded details

#### Page 24

Case 5) Folding due to under sampling  sampling rate fs = 125Hz leads
to a type of aliasing called folding.

\[
\hat{\omega}=2\pi\frac{100}{125}=2\pi\frac{4}{5}=\frac{8\pi}{5}=1.6\pi
\]

[diagram: frequency-domain sketch on left with horizontal axis and two vertical spectral lines labeled \(-100Hz\) and \(100Hz\). Arrow points to right-hand folded discrete-frequency sketch.]

[diagram: horizontal \(\omega\)-axis with vertical lines at approximately \(-1.6\pi\), \(-\pi\), \(-0.4\pi\), \(0\), \(0.4\pi\), \(\pi\), \(1.6\pi\). The \(0\) line is tallest. Curved bracket/arrow over the region around \(0\) indicating folding/shift. Small asterisks mark the lines near \(-1.6\pi\) and \(0.4\pi\). Axis labels visible: \(-1.6\pi\), \(-\pi\), \(-0.4\pi\), \(0.4\pi\), \(\pi\), \(1.6\pi\).]

In this case, an interesting thing happens. The two frequency components between
\(\pm\pi\) are at \(\hat{\omega}=0.4\pi\), but the one at \(\hat{\omega}=+0.4\pi\) is an alias of the negative
frequency component at \(-1.6\pi\), which is why this situation is called folding.

\[
x[n]=\cos(-1.6\pi n+200n+\pi/6)
\]

\[
=\cos(-1.6\pi n+\pi/6)
\]

\[
=\cos(1.6\pi n-\pi/6)
\]

\[
\therefore y(t)=\cos(1.6\pi .125t-\

[Truncated for analysis]

### Key points

- Folding occurs when an aliased component crosses from negative to positive frequency or vice versa
- Example sampling rate is $f_s=125$ Hz for a 100 Hz sinusoid
- Normalized frequency is $\hat{\omega}=8\pi/5=1.6\pi$
- $1.6\pi$ is outside the principal interval
- The component at $+0.4\pi$ is an alias of the negative-frequency component at $-1.6\pi$
- The sequence can be rewritten with a phase sign change
- Reconstruction gives $y(t)=\cos(2\pi100t-\pi/6)$
- The main folding fact is that the reconstructed analog phase changes sign

### Related topics

- [[discrete-time-aliases-and-principal-frequency|Discrete-Time Aliases and Principal Frequency]]
- [[spectrum-view-of-sampling-and-reconstruction|Spectrum View of Sampling and Reconstruction]]
- [[aliasing-problem-solving-with-multiple-sinusoids|Aliasing Problem Solving with Multiple Sinusoids]]

### Relationships

- example-of: [[discrete-time-aliases-and-principal-frequency|Discrete-Time Aliases and Principal Frequency]]
- example-of: [[spectrum-view-of-sampling-and-reconstruction|Spectrum View of Sampling and Reconstruction]]
