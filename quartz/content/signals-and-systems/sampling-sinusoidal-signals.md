---
title: "Sampling Sinusoidal Signals"
date: "2026-04-30T16:26:39.261Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "signals-and-systems-full-notes"
source_file: "Signals and Systems full notes.pdf"
locations: ["Page 17"]
related: ["sampling-continuous-time-signals-into-discrete-time-sequences", "discrete-time-aliases-and-principal-frequency", "sampling-and-plotting-continuous-sinusoids", "sinusoid-period-frequency-and-time-shift"]
tags: ["sampling-sinusoidal-signals", "discrete-time-frequency", "normalized-frequency", "sampling-frequency", "sampling-period", "cosine"]
source_images: ["/signals-and-systems/assets/signals-and-systems-full-notes-page-017.png"]
---

## Sampling Sinusoidal Signals

Source: [[signals-and-systems-full-notes|Signals and Systems Full Notes: Sinusoids, Spectra, Sampling, Aliasing, and FIR Filters]]

Locations: Page 17

Sampling a continuous-time sinusoid produces a discrete-time cosine whose frequency is normalized by the sampling rate. Starting from $A\cos(\omega_0t+\Phi)$ and sampling at $t=nT_s$ gives $x[n]=A\cos(\omega_0nT_s+\Phi)=A\cos(\hat{\omega}_0n+\Phi)$. The normalized discrete-time frequency is $\hat{\omega}_0:=\omega_0T_s=2\pi f_0/f_s$. Unlike $\omega_0$, which has units rad/s, $\hat{\omega}_0$ is dimensionless and measured in radians per sample-like index because the sequence index $n$ has no physical units. The sequence $x[n]$ contains only numbers and does not itself store the sampling period $T_s$. Therefore many different continuous-time sinusoids can produce exactly the same discrete-time sinusoid after sampling. The notes show this with a continuous waveform $x(t)=\cos(2\pi(100)t)$ sampled with different sampling periods, producing different discrete-time formulas such as $x[n]=\cos(0.1\pi n)$ or $x[n]=\cos(0.4\pi n)$.

### Source snapshots

![Signals and Systems full notes Page 17](/signals-and-systems/assets/signals-and-systems-full-notes-page-017.png)

### Page-grounded details

#### Page 17

=> Sampling Sinusoidal signals

If we sample a sinusoid of the form `A cos(ω_0t + Φ)`, we obtain:

`x[n] = A cos(ω_0 nTₛ + Φ)`

`= A cos(ω̂_0 n + Φ)`

where we have defined `ω̂_0` to be:

[boxed]
`ω̂_0 := ω_0Tₛ = 2π f_0 / fₛ`
[/boxed]

where `f_0` is the frequency of the signal
and `fₛ` is the sampling frequency

The signal `x[n]` is a discrete-time cosine signal, and `ω̂_0` is its discrete time frequency. It is the normalized version of the continuous-time radian frequency with respect to the sampling frequency. Since `ω_0` has units rad/s, the units of `ω̂_0 = ω_0Tₛ` are radians, rather it is as dimensionless quantity. This is entirely consistent with the fact that the index `n` in `x[n]` is dimensionless, its just a point (versus time in continuous signals)

The discrete time signal `x[n]` is just a sequence of numbers, and these numbers also carry no information about the sampling period `Tₛ` used in obtaining them meaning an infinite number of continuous-time sinusoidal signals can be transformed into the same discrete time sinusoid by sampling

[graph: continuous sinusoidal waveform plotted versus time. Vertical axis marked `1`, `0`, `-1`; horizontal axis labeled `time`.]

->

[Truncated for analysis]

### Key points

- Sampling $A\cos(\omega_0t+\Phi)$ gives $x[n]=A\cos(\omega_0nT_s+\Phi)$
- Discrete-time form is $x[n]=A\cos(\hat{\omega}_0n+\Phi)$
- Normalized frequency is $\hat{\omega}_0=\omega_0T_s$
- Using $f_s$, $\hat{\omega}_0=2\pi f_0/f_s$
- $\hat{\omega}_0$ is dimensionless because $n$ is dimensionless
- A discrete-time sequence does not carry sampling-period information
- Infinitely many continuous-time sinusoids can sample to the same discrete-time sinusoid
- Examples include sampled versions of $x(t)=\cos(2\pi(100)t)$

### Related topics

- [[sampling-continuous-time-signals-into-discrete-time-sequences|Sampling Continuous-Time Signals into Discrete-Time Sequences]]
- [[discrete-time-aliases-and-principal-frequency|Discrete-Time Aliases and Principal Frequency]]
- [[sampling-and-plotting-continuous-sinusoids|Sampling and Plotting Continuous Sinusoids]]
- [[sinusoid-period-frequency-and-time-shift|Sinusoid Period, Frequency, and Time Shift]]

### Relationships

- part-of: [[sampling-continuous-time-signals-into-discrete-time-sequences|Sampling Continuous-Time Signals into Discrete-Time Sequences]]
- applies-to: [[sinusoid-period-frequency-and-time-shift|Sinusoid Period, Frequency, and Time Shift]]
