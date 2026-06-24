---
title: "Continuous-Time Sinusoidal Signal Parameters"
date: "2026-04-30T16:26:39.261Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "signals-and-systems-full-notes"
source_file: "Signals and Systems full notes.pdf"
locations: ["Page 1"]
related: ["sinusoid-period-frequency-and-time-shift", "sampling-sinusoidal-signals", "complex-exponential-signals"]
tags: ["sinusoidal-signals", "amplitude", "phase", "radian-frequency", "cyclic-frequency", "cosine"]
source_images: ["/signals-and-systems/assets/signals-and-systems-full-notes-page-001.png"]
---

## Continuous-Time Sinusoidal Signal Parameters

Source: [[signals-and-systems-full-notes|Signals and Systems Full Notes: Sinusoids, Spectra, Sampling, Aliasing, and FIR Filters]]

Locations: Page 1

A continuous-time sinusoidal signal is represented by a cosine whose angle is a function of time. The general two-parameter frequency form is $x(t)=A\cos(\omega_0t+\phi)=A\cos(2\pi f_0t+\phi)$, with $\omega_0=2\pi f_0$. The amplitude $A$ scales the waveform, so because $\cos\theta$ ranges from $-1$ to $+1$, the signal ranges from $-A$ to $+A$. The phase $\phi$ is measured in radians and determines the starting point or horizontal position of the signal within its cycle. The radian frequency $\omega_0$ has units rad/s when time is in seconds, while the cyclic frequency $f_0$ has units $s^{-1}$, hertz, or cycles per second. Sine waves are converted to cosine form because the notes use cosine as the standard sinusoid: $A\sin(\omega_0t+\phi)=A\cos(\omega_0t+\pi/2+\phi)$. The periodicity of cosine is expressed by $\cos x=\cos a \Leftrightarrow x=\pm a+2\pi k$, $k\in\mathbb{Z}$.

### Source snapshots

![Signals and Systems full notes Page 1](/signals-and-systems/assets/signals-and-systems-full-notes-page-001.png)

### Page-grounded details

#### Page 1

ACT I Signals

(Chapter 1. Sinusoids (continuous time signals))

1.1 Sinusoidal Signals

- The most general mathematical formula for a sinusoidal time signal is
obtained by making the argument (the angle) of the cosine function be a
function of t (time). The following equation is two-parameter form:

[boxed] x(t) = A cos(ω_0t + φ) = A cos(2πf_0t + φ)

which are related by defining ω_0 = 2πf_0. In either form,
there are three important parameters (A, ω_0, φ). The names and interpretation
of these parameters are as follows:

a) A is called the Amplitude which is a scaling factor that determines how large
the cosine signal will be. Since cos θ oscillates between -1, +1, signal
x(t) oscillates between -A, +A

b) φ is called the phase, in radians which is its starting point or horizontal
position within its cycle.

! if we have a sine signal convert it to cosine-sine; (because we will use cos)
[boxed] - x(t) = A sin(ω_0t + φ) = A cos(ω_0t + π/2 + φ)

c) ω_0 is called the radian frequency. Since the argument of the cosine function must
be in radians which is dimensionless, the quantity ω_0t must likewise be dimensionless
∴ ω_0 must have units of rad/s if t has units of seconds. Similarly

[Truncated for analysis]

### Key points

- General sinusoid: $x(t)=A\cos(\omega_0t+\phi)=A\cos(2\pi f_0t+\phi)$
- Radian and cyclic frequency are related by $\omega_0=2\pi f_0$
- Amplitude $A$ makes the signal oscillate between $-A$ and $+A$
- Phase $\phi$ gives the starting point or horizontal position within the cycle
- $\omega_0$ has units rad/s when $t$ is measured in seconds
- $f_0$ has units $s^{-1}$, hertz, or cycles per second
- Sine can be rewritten as cosine using a $\pi/2$ phase shift
- Cosine reaches the same value at angles $x=\pm a+2\pi k$

### Related topics

- [[sinusoid-period-frequency-and-time-shift|Sinusoid Period, Frequency, and Time Shift]]
- [[sampling-sinusoidal-signals|Sampling Sinusoidal Signals]]
- [[complex-exponential-signals|Complex Exponential Signals]]

