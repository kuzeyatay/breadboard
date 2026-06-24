---
title: "Shannon Sampling Theorem and Ideal Reconstruction"
date: "2026-04-30T16:26:39.261Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "signals-and-systems-full-notes"
source_file: "Signals and Systems full notes.pdf"
locations: ["Page 20", "Page 23", "Page 24"]
related: ["discrete-time-aliases-and-principal-frequency", "spectrum-view-of-sampling-and-reconstruction", "sampling-continuous-time-signals-into-discrete-time-sequences"]
tags: ["shannon-sampling-theorem", "nyquist-rate", "ideal-reconstruction", "d-to-c-converter", "low-pass-filter", "bandlimited"]
source_images: ["/signals-and-systems/assets/signals-and-systems-full-notes-page-020.png", "/signals-and-systems/assets/signals-and-systems-full-notes-page-023.png"]
---

## Shannon Sampling Theorem and Ideal Reconstruction

Source: [[signals-and-systems-full-notes|Signals and Systems Full Notes: Sinusoids, Spectra, Sampling, Aliasing, and FIR Filters]]

Locations: Page 20, Page 23, Page 24

The Shannon Sampling theorem states that a continuous-time signal whose highest frequency component is $f_{\max}$ can be represented exactly by samples $x[n]=x(nT_s)$ if the sampling rate $f_s=1/T_s$ is greater than $2f_{\max}$. The minimum sampling rate $2f_{\max}$ is called the Nyquist rate, but the notes emphasize that exact reconstruction requires $f_s>2f_{\max}$ rather than $f_s\ge2f_{\max}$. For a sinusoid, this means reconstruction is possible when there are more than two samples per period; aliasing occurs when sampling is too slow. Ideal reconstruction is described as a D-to-C conversion that recovers a continuous-time signal from its samples. Because the normalized frequency is interpreted in the principal interval $-\pi<\hat{\omega}<\pi$, converting back to analog frequency gives $-f_s/2<f_0<f_s/2$. Thus the output frequency of ideal D-to-C conversion always lies between $-f_s/2$ and $+f_s/2$. The notes also state that non-bandlimited periodic piecewise constant signals require low-pass filtering because their Fourier series contains infinitely many harmonics.

### Source snapshots

![Signals and Systems full notes Page 20](/signals-and-systems/assets/signals-and-systems-full-notes-page-020.png)

![Signals and Systems full notes Page 23](/signals-and-systems/assets/signals-and-systems-full-notes-page-023.png)

### Page-grounded details

#### Page 20

-> Shannon Sampling theorem: States that, a continuous time signal will
   use in process, or higher than fmax can be represented exactly by
   use samples x[n] = x(nTs) if the samples are taken at a rate fs = 1/Ts
   that is greater than 2fmax; that is

        ┌─────────────┐
        │ fs > 2fmax  │
        └─────────────┘

   (Where fmax is the highest frequency component
    in a signal)

   -> The minimum sampling rate 2fmax is called the Nyquist Rate

The Shannon theorem states that reconstruction of a sinusoid is possible
if we have more than two samples per period. Aliasing occurs when we
dont sample fast enough


-> Ideal Reconstruction:

The sampling theorem suggests that a process exists for recovering
a continuous time signal from its samples. This reconstruction process
will undo the C-to-D conversion so its called D to C conversion

[diagram: y[n] enters a block labeled "ideal D-to-C converter"; output is y(t);
an upward arrow into the block is labeled "fs = 1/Ts"]

        y[n] ───> ┌──────────────┐ ───> y(t)
                  │ ideal        │
                  │ D-to-C       │
                  │ converter    │
                  └──────────────┘

[Truncated for analysis]

#### Page 23

Case (4)  Aliasing due to borderline Sampling

when fs = 2f0 an interesting thing happens.

ω̂ = 2π * 100/200 = π

∴ x[n] = cos(πn + π/6)

[Diagram: frequency-domain sketch with vertical spectral lines at -100Hz and +100Hz. A star marks the left line at -100Hz. Arrow points to a normalized digital frequency sketch.]

[Diagram: normalized frequency-domain sketch with vertical lines at -π, 0, and π on ω axis. Left line at -π has a star. Curved arrow labeled 2π maps from -π to π, indicating periodic equivalence.]

However -π is not in the principal interval (it is not included), therefore we move it to the principal interval by +2π.

x[n] = e^(jπn) ( e^(jπ/6) + e^(-jπ/6) ) / 2

= e^(jπn) cos(π/6)

= (-1)^n * √3/2

[Graph: small discrete-time waveform sketch on right, showing alternating samples along a cosine-like curve: positive peak, negative trough, positive peak.]

- This can be reconstructed with (-1)^n = cos(πn)
as y(t) = √3/2 cos(2π100t), which converts the phase into an amplitude.

∴ fs > 2fmax and NOT fs >= 2fmax
["fs >= 2fmax" is crossed out.]

∴ Sampling at Nyquist is yes

[Boxed equation:]
x[n] = A cos(ϕ) cos(πn), or A cos(ϕ)(-1)^n

since cos(πn) = (-1)^n

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

- Shannon theorem requires $f_s>2f_{\max}$ for exact sample representation
- $f_{\max}$ is the highest frequency component in the signal
- The Nyquist rate is $2f_{\max}$
- Reconstruction of a sinusoid requires more than two samples per period
- Aliasing occurs when the signal is not sampled fast enough
- Ideal D-to-C conversion reconstructs a continuous-time signal from samples
- Principal normalized frequency satisfies $-\pi<\hat{\omega}<\pi$
- D-to-C output frequency lies in $-f_s/2<f_0<f_s/2$

### Related topics

- [[discrete-time-aliases-and-principal-frequency|Discrete-Time Aliases and Principal Frequency]]
- [[spectrum-view-of-sampling-and-reconstruction|Spectrum View of Sampling and Reconstruction]]
- [[sampling-continuous-time-signals-into-discrete-time-sequences|Sampling Continuous-Time Signals into Discrete-Time Sequences]]

### Relationships

- contrasts-with: [[discrete-time-aliases-and-principal-frequency|Discrete-Time Aliases and Principal Frequency]]
