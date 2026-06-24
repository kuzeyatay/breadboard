---
title: "Spectrum View of Sampling and Reconstruction"
date: "2026-04-30T16:26:39.261Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "signals-and-systems-full-notes"
source_file: "Signals and Systems full notes.pdf"
locations: ["Page 21", "Page 22", "Page 23"]
related: ["discrete-time-aliases-and-principal-frequency", "shannon-sampling-theorem-and-ideal-reconstruction", "folding-due-to-under-sampling"]
tags: ["spectrum-view", "sampling", "reconstruction", "aliasing", "principal-interval", "nyquist"]
source_images: ["/signals-and-systems/assets/signals-and-systems-full-notes-page-021.png", "/signals-and-systems/assets/signals-and-systems-full-notes-page-022.png"]
---

## Spectrum View of Sampling and Reconstruction

Source: [[signals-and-systems-full-notes|Signals and Systems Full Notes: Sinusoids, Spectra, Sampling, Aliasing, and FIR Filters]]

Locations: Page 21, Page 22, Page 23

The spectrum view shows how continuous-time sinusoidal spectra become periodic discrete-time spectra after sampling. A continuous-time sinusoid $x(t)=A\cos(\omega_0t+\phi)$ has two spectrum lines at $\pm\omega_0$ with complex amplitudes $\frac{1}{2}Ae^{\pm j\phi}$. After sampling at $F_s$, the discrete-time signal is $x[n]=A\cos((\omega_0/F_s)n+\phi)$ and has lines at $\hat{\omega}=\pm\omega_0/F_s$, along with all aliases at $\omega_0/f_s+2\pi\ell$ and $-\omega_0/f_s+2\pi\ell$. The notes analyze $x(t)=\cos(2\pi100t+\pi/6)$ under several sampling rates. With proper sampling at $F_s=500$ Hz, $\hat{\omega}=2\pi(100/500)=2\pi/5$, and reconstruction gives $y(t)=\cos(2\pi100t+\pi/6)$, exactly the original. With under-sampling at $f_s=80$ Hz, $\hat{\omega}=2.5\pi$ aliases to $0.5\pi$, producing $y(t)=\cos(40\pi t+\pi/6)$ instead of the original. Sampling at $f_s=f_0$ gives DC, while borderline sampling at $f_s=2f_0$ converts phase into amplitude: $x[n]=A\cos(\phi)(-1)^n$.

### Source snapshots

![Signals and Systems full notes Page 21](/signals-and-systems/assets/signals-and-systems-full-notes-page-021.png)

![Signals and Systems full notes Page 22](/signals-and-systems/assets/signals-and-systems-full-notes-page-022.png)

### Page-grounded details

#### Page 21

3.2 Spectrum View of Sampling and Reconstruction

- Suppose that we start with a continuous time sinusoid, x(t)=A cos(ω_0t+φ)
  whose spectrum consists of two spectrum lines at ±ω_0, with complex
  amplitudes of 1/2 Ae±jφ. The spectrum of the sampled discrete-time signal,

        x[n] = x(n/Fs) = A cos((ω_0/Fs)n + φ)

             = 1/2 Ae^jφ e^j(ω_0/Fs)n + 1/2 Ae^-jφ e^-j(ω_0/Fs)n

Also has two spectrum lines at ω̂ = ±ω_0/Fs, but it also must
contain all the aliases at the following discrete-time frequencies:

        [boxed]
        ω̂ = ω_0/fs + 2πℓ        ℓ = 0, ±1, ±2, ±3
        or
        ω̂ = -ω_0/fs + 2πℓ       ℓ = 0, ±1, ±2, ±3
        [/boxed]

- The next sections show examples of sampling a continuous time 100Hz
  sinusoid of the form x(t)=cos(2π100t + π/6) with varying sampling
  frequency, where Fs: 2Fmax | Fs > 2Fmax | Fs < 2Fmax.

Case (1) proper sampling: is when Fs > 2Fmax. Take for example
Fs = 500Hz, then

        ω̂ = 2π 100/500 = 2π/5

        ∴ x[n] = cos((2π/5)n + π/6).

[Diagram: analog frequency spectrum with two vertical lines at -100Hz and 100Hz, each labeled 1/2 e^-jπ/6 and 1/2 e^jπ/6 respectively. Horizontal axis labeled "analog frequency (Hz)". Sampl

[Truncated for analysis]

#### Page 22

Case (2) Aliasing due to under-sampling

- when fs < 2fo, the signal is under-sampled and we say that aliasing
has occured if fs = 80 Hz.

ω̂ = 2π (fo / fs) = 2π (100 / 80) = 2.5π

[diagram: frequency-domain impulses at -100 Hz and 100 Hz, arrow to normalized frequency axis]

->

[diagram: normalized frequency axis ω̂ from -2.5π to 2.5π with repeated spectral impulses and brackets showing folding/aliasing. Labels include -2.5π, -1.5π, -π, -0.5π, 0.5π, π, 1.5π, 2.5π. Asterisks mark impulses near -2.5π, -0.5π, 0.5π, 1.5π.]

down x[n] = 1/2 e^j(0.5πn) e^jπ/6 + 1/2 e^-j(0.5πn) e^-jπ/6

down x[n] = cos(0.5πn + π/6)

down y(t) = cos(0.5π * 80t + π/6)

= cos(40πt + π/6) which is not the original signal.

Case (3) Aliasing due to underSampling -> DC ; happens when
fs = fo or fs = fo/2, take fs = 100 Hz as example

ω̂ = 2π (100 / 100) = 2π

down x[n] = cos(2πn + π/6) = cos(π/6) ⇔ 1/2 e^jπ/6 + 1/2 e^-jπ/6

- y(t) = √3/2

[diagram: cosine wave versus t, sampled points shown, y-axis labels 1, 0, -1. Label under graph: fs = fo.]

[diagram: cosine wave versus t, sampled points shown, y-axis labels 1, 0, -1. Label under graph: fs = 1/2 fo.]

[diagram: frequency-domain impulses at -100 Hz and 100

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

### Key points

- A continuous sinusoid has spectrum lines at $\pm\omega_0$
- The line amplitudes are $\frac{1}{2}Ae^{j\phi}$ and $\frac{1}{2}Ae^{-j\phi}$
- Sampling maps frequency to normalized frequency $\hat{\omega}=\omega_0/F_s$
- Discrete-time spectra include all aliases spaced by $2\pi$
- Proper sampling example uses $F_s=500$ Hz for a 100 Hz sinusoid
- Under-sampling at $f_s=80$ Hz reconstructs a 20 Hz-equivalent cosine $\cos(40\pi t+\pi/6)$
- Sampling at $f_s=f_0$ produces a constant value $\sqrt{3}/2$ in the example
- At Nyquist borderline, $x[n]=A\cos(\phi)(-1)^n$

### Related topics

- [[discrete-time-aliases-and-principal-frequency|Discrete-Time Aliases and Principal Frequency]]
- [[shannon-sampling-theorem-and-ideal-reconstruction|Shannon Sampling Theorem and Ideal Reconstruction]]
- [[folding-due-to-under-sampling|Folding Due to Under-Sampling]]

### Relationships

- applies-to: [[discrete-time-aliases-and-principal-frequency|Discrete-Time Aliases and Principal Frequency]]
- related: [[shannon-sampling-theorem-and-ideal-reconstruction|Shannon Sampling Theorem and Ideal Reconstruction]]
