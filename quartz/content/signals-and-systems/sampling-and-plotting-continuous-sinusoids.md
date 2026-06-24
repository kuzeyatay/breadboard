---
title: "Sampling and Plotting Continuous Sinusoids"
date: "2026-04-30T16:26:39.261Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "signals-and-systems-full-notes"
source_file: "Signals and Systems full notes.pdf"
locations: ["Page 3"]
related: ["sampling-sinusoidal-signals", "shannon-sampling-theorem-and-ideal-reconstruction", "discrete-time-aliases-and-principal-frequency", "continuous-time-sinusoidal-signal-parameters"]
tags: ["sampling-period", "sampling", "linear-interpolation", "40hz", "reconstruction"]
source_images: ["/signals-and-systems/assets/signals-and-systems-full-notes-page-003.png"]
---

## Sampling and Plotting Continuous Sinusoids

Source: [[signals-and-systems-full-notes|Signals and Systems Full Notes: Sinusoids, Spectra, Sampling, Aliasing, and FIR Filters]]

Locations: Page 3

To plot or process a continuous-time function on a computer, the signal must be evaluated at a discrete set of times. The notes choose uniformly spaced times $t_n=nT_s$, where $n$ is an integer and $T_s$ is the sampling period. For example, the continuous sinusoid $x(t)=20\cos(2\pi40t-0.4\pi)$ becomes $x(nT_s)=20\cos(2\pi40nT_s-0.4\pi)$ when sampled. If $T_s=0.005\text{ s}$, the signal is observed only at integer multiples of $0.005\text{ s}$, so the plotted result is a discrete set of points rather than a continuous waveform. The accuracy of a plot depends on the number of samples per period, not just the absolute value of $T_s$. Good reconstruction requires sampling frequently enough that the cosine does not change much between sample points. The notes mention linear interpolation as one reconstruction method, while warning that insufficient sampling creates an inaccurate plot.

### Source snapshots

![Signals and Systems full notes Page 3](/signals-and-systems/assets/signals-and-systems-full-notes-page-003.png)

### Page-grounded details

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

- Continuous functions are plotted or processed by evaluating them at discrete times
- Uniform sampling uses $t_n=nT_s$ for integer $n$
- $T_s$ is called the sampling period
- Example sampled signal: $x(nT_s)=20\cos(2\pi40nT_s-0.4\pi)$
- $T_s=0.005\text{ s}$ produces samples every $0.005\text{ s}$ rather than a continuous trace
- Plot accuracy depends on samples per sinusoidal period
- A smaller sampling period is needed when the sinusoid changes rapidly
- Linear interpolation is one reconstruction method

### Related topics

- [[sampling-sinusoidal-signals|Sampling Sinusoidal Signals]]
- [[shannon-sampling-theorem-and-ideal-reconstruction|Shannon Sampling Theorem and Ideal Reconstruction]]
- [[discrete-time-aliases-and-principal-frequency|Discrete-Time Aliases and Principal Frequency]]
- [[continuous-time-sinusoidal-signal-parameters|Continuous-Time Sinusoidal Signal Parameters]]

### Relationships

- applies-to: [[continuous-time-sinusoidal-signal-parameters|Continuous-Time Sinusoidal Signal Parameters]]
