---
title: "Sinusoid Period, Frequency, and Time Shift"
date: "2026-04-30T16:26:39.261Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "signals-and-systems-full-notes"
source_file: "Signals and Systems full notes.pdf"
locations: ["Page 2", "Page 3"]
related: ["continuous-time-sinusoidal-signal-parameters", "sampling-sinusoidal-signals", "discrete-time-aliases-and-principal-frequency"]
tags: ["period", "frequency", "time-shift", "phase", "principal-value", "modulo-2"]
source_images: ["/signals-and-systems/assets/signals-and-systems-full-notes-page-002.png", "/signals-and-systems/assets/signals-and-systems-full-notes-page-003.png"]
---

## Sinusoid Period, Frequency, and Time Shift

Source: [[signals-and-systems-full-notes|Signals and Systems Full Notes: Sinusoids, Spectra, Sampling, Aliasing, and FIR Filters]]

Locations: Page 2, Page 3

A sinusoid is periodic, and its period $T_0$ is the time duration of one complete cycle. Frequency and period are reciprocal quantities: $f_0=1/T_0$ and $T_0=1/f_0$. A larger frequency creates more cycles per unit time, while $f_0=0$ produces a constant cosine value rather than an oscillation. Time shifting is described by writing a signal as $x_1(t)=s(t-t_1)$. If $t_1>0$, the waveform is delayed and shifts right; if $t_1<0$, it is advanced and shifts left. For a sinusoid, $x_0(t-t_1)=A\cos(\omega_0(t-t_1))=A\cos(\omega_0t-\omega_0t_1)=A\cos(\omega_0t+\phi)$, so $\phi=-\omega_0t_1=-2\pi(t_1/T_0)$ and $t_1=-\phi/\omega_0=-\phi T_0/(2\pi)$. Phase is reduced modulo $2\pi$ so the principal phase lies between $-\pi$ and $+\pi$.

### Source snapshots

![Signals and Systems full notes Page 2](/signals-and-systems/assets/signals-and-systems-full-notes-page-002.png)

![Signals and Systems full notes Page 3](/signals-and-systems/assets/signals-and-systems-full-notes-page-003.png)

### Page-grounded details

#### Page 2

The sinusoid in this figure is a
periodic signal. The period of the
sinusoid, denoted by To, is the time
duration of one cycle of the sinusoid.
The frequency of the sinusoid determines
its period:

f_0 = 1 / T_0  ;  T_0 = 1 / f_0  [boxed]

[Diagram: Sinusoidal graph with vertical axis labeled A and horizontal axis labeled t. Vertical scale marks: 20, 10, 0, -10, -20. Time axis marks: -0.03, -0.02, -0.01, 0, 0.01, 0.02, 0.03, 0.04. A bracket above two positive peaks is labeled "Period". The sinusoid has peaks near 20 and troughs near -20.]

Sinusoidal signals with parameters A = 20, w_0 = 2π(40),
f_0 = 40Hz and φ = -0.4π rad.

=> A higher value for the frequency results in more cycles per time ;

[Three small graphs shown side by side.]

[Left graph: vertical axis labeled A, horizontal axis labeled t, amplitude marked 5. Fast cosine-like waveform with several cycles.]
cosine signal f_0 = 200Hz

[Middle graph: vertical axis labeled A, horizontal axis labeled t, amplitude marked 5. Slower cosine-like waveform with fewer cycles.]
cosine signal f_0 = 100Hz

[Right graph: vertical axis labeled A, horizontal axis labeled t, amplitude marked 5. Nearly constant horizontal line.]
cosine sign

[Truncated for analysis]

#### Page 3

Sinusoid that is closest to t=0. Since this peak around t=0 must lie within
the interval [-π, 0.2π] =? the phase will always satisfy -π < θ < π. However
cosine is periodic with 2π, & each multiple of 2π corresponds to picking a
different peak of the periodic waveform. Thus another way to compute the phase
is to find any positive peak of the sinusoid and measure its corresponding
time location, compute its t=0 phase and add or subtract an integer multiple
of 2π to make the result between -π and +π. This operation is called
reducing modulo 2π.

The value of the phase that falls between -π and +π is called the
principal value of the phase.

7.2 Sampling and Plotting Sinusoids.

If we want to plot or process a continuous function x(t) like

x(t) = 20 cos(2π40t - 0.4π)

we must evaluate x(t) at a discrete set of times. Usually, we pick a
uniform set tₙ = nTₛ, where n is an integer. then

x(nTₛ) = 20 cos(2π40nTₛ - 0.4π)

where Tₛ is called the sampling period.

ex: if Tₛ = 0.005s then we would see the sinusoid's value every integer
multiple of 0.005s, making it not continuous. It would look something like:

[graph: vertical axis labeled 20 at top and -20 near bottom; horizontal time axis

[Truncated for analysis]

### Key points

- The period $T_0$ is the duration of one sinusoidal cycle
- Frequency and period satisfy $f_0=1/T_0$ and $T_0=1/f_0$
- Higher frequency means more cycles per time interval
- A signal $s(t-t_1)$ is delayed when $t_1>0$ and advanced when $t_1<0$
- For sinusoids, phase and time shift satisfy $\phi=-\omega_0t_1$
- The time shift can be computed as $t_1=-\phi/\omega_0=-\phi T_0/(2\pi)$
- Modulo $2\pi$ reduction selects an equivalent phase in the principal interval
- The principal value of phase falls between $-\pi$ and $+\pi$

### Related topics

- [[continuous-time-sinusoidal-signal-parameters|Continuous-Time Sinusoidal Signal Parameters]]
- [[sampling-sinusoidal-signals|Sampling Sinusoidal Signals]]
- [[discrete-time-aliases-and-principal-frequency|Discrete-Time Aliases and Principal Frequency]]

### Relationships

- part-of: [[continuous-time-sinusoidal-signal-parameters|Continuous-Time Sinusoidal Signal Parameters]]
