---
title: "Discrete-Time Aliases and Principal Frequency"
date: "2026-04-30T16:26:39.261Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "signals-and-systems-full-notes"
source_file: "Signals and Systems full notes.pdf"
locations: ["Page 18", "Page 19"]
related: ["sampling-sinusoidal-signals", "shannon-sampling-theorem-and-ideal-reconstruction", "spectrum-view-of-sampling-and-reconstruction"]
tags: ["aliases", "principal-alias", "folded-alias", "discrete-time-sinusoid", "aliasing", "phase-angle"]
source_images: ["/signals-and-systems/assets/signals-and-systems-full-notes-page-018.png", "/signals-and-systems/assets/signals-and-systems-full-notes-page-019.png"]
---

## Discrete-Time Aliases and Principal Frequency

Source: [[signals-and-systems-full-notes|Signals and Systems Full Notes: Sinusoids, Spectra, Sampling, Aliasing, and FIR Filters]]

Locations: Page 18, Page 19

Aliases arise because discrete-time sinusoidal frequencies differing by integer multiples of $2\pi$ can produce identical sample values. The notes illustrate this with $x_1[n]=\cos(0.4\pi n)$ and $x_2[n]=\cos(2.4\pi n)$. Since $x_2[n]=\cos(2\pi n+0.4\pi n)=\cos(0.4\pi n)$ for integer $n$, the two formulas are different names for the same sequence. The general alias frequencies of $0.4\pi$ are $\hat{\omega}_\ell=0.4\pi+2\pi\ell$, with integer $\ell$. The principal alias is the unique alias in the interval $-\pi<\hat{\omega}\le\pi$. A folded alias also occurs because cosine is even: $A\cos((2\pi-\hat{\omega})n-\phi)=A\cos(\hat{\omega}n+\phi)$, so the sign of phase for folded aliases must be opposite to the sign of the principal alias phase. The notes summarize aliases of a sinusoid as $\hat{\omega}_0$, $\hat{\omega}_0+2\pi\ell$, and $2\pi\ell-\hat{\omega}_0$.

### Source snapshots

![Signals and Systems full notes Page 18](/signals-and-systems/assets/signals-and-systems-full-notes-page-018.png)

![Signals and Systems full notes Page 19](/signals-and-systems/assets/signals-and-systems-full-notes-page-019.png)

### Page-grounded details

#### Page 18

=> The concept of aliases

- We introduce the concept of an alias (two names for the same thing) by showing
that two different discrete time sinusoid formulas can define the same signal
values.

ex/ Take two discrete-time cosine signals x_1[n] = cos(0.4πn) and x_2[n] = cos(2.4πn)

[Diagram: plotted cosine waves on axes labeled 1, 0, -1. Two continuous-looking curves are drawn: a slower cosine and a faster cosine. Black dots mark discrete sample values, showing both formulas pass through the same sample points.]

- Since x_2[n] = cos(2πn + 0.4πn) = cos(0.4πn)
down
these two signals are two different names
for the same thing. This is solely
because cosine is periodic with 2π.

- In the previous exercise, it should be easy to see that adding any integer
multiple of 2π to 0.4π gives an alias, so the general formula holds for
the freq. aliases of 0.4π:

ω̂ₗ = 0.4π + 2πl        l = 1, 2, ...        (l could be negative if we allow
                                             negative frequencies)

The principal alias is defined to be the unique alias frequency in
the interval

-π < ω̂ <= π

- another alias, called the folded alias is defined as:

ω̂ₗᶠ = -0.4π + 2πl        l = 1, 2, ...

[Truncated for analysis]

#### Page 19

In summary, we can write the following general formulas for aliases of a
sinusoid with frequency ω_0:

[boxed]
\hat{ω}_0, \hat{ω}_0 + 2πl, 2πl - \hat{ω}_0
[/boxed]

=> Sampling and Aliasing

- If we hope to reconstruct the original analog signal, it is necessary
that the normalized frequency \hat{ω}_0 be the principal alias, that is,

-π < \hat{ω}_0 = ω_0Tₛ <= π

When the inequality above is not satisfied, we say that aliasing has occurred,
henceforth, whenever we use the term aliasing, we mean that when a signal is
sampled, the resulting samples are identical to those obtained by sampling
a lower frequency signal corresponding to the principal alias.

=> Spectrum of a Discrete time Signal

The spectrum of a continuous-time sinusoid exhibits two spectrum lines at
frequencies ±ω rad/s. The alias phenomenon changes the spectrum plot because
a given discrete time sinusoidal sequence could correspond to an infinite
number of different frequencies \hat{ω}.

[diagram: spectrum plot of a discrete-time sinusoid. Vertical axis labeled "Magnitude"; horizontal axis labeled "Frequency (\hat{ω})". Tick labels include -2.4π, -1.6π, -0.4π, 0, 0.4π, 1.6π, 2.4π. Several vertical spectral lines of h

[Truncated for analysis]

### Key points

- Discrete-time frequencies differing by $2\pi\ell$ can define the same sequence
- $\cos(2.4\pi n)=\cos(0.4\pi n)$ for integer $n$
- Alias formula: $\hat{\omega}_\ell=0.4\pi+2\pi\ell$
- The principal alias lies in $-\pi<\hat{\omega}\le\pi$
- Folded aliases have form $-0.4\pi+2\pi\ell$ in the example
- Folded aliases reverse the algebraic sign of the phase angle
- General aliases include $\hat{\omega}_0$, $\hat{\omega}_0+2\pi\ell$, and $2\pi\ell-\hat{\omega}_0$
- Aliasing means samples match those of a lower-frequency signal corresponding to the principal alias

### Related topics

- [[sampling-sinusoidal-signals|Sampling Sinusoidal Signals]]
- [[shannon-sampling-theorem-and-ideal-reconstruction|Shannon Sampling Theorem and Ideal Reconstruction]]
- [[spectrum-view-of-sampling-and-reconstruction|Spectrum View of Sampling and Reconstruction]]

### Relationships

- depends-on: [[sampling-sinusoidal-signals|Sampling Sinusoidal Signals]]
