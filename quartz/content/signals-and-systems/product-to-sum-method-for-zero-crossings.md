---
title: "Product-to-Sum Method for Zero Crossings"
date: "2026-04-30T16:26:39.261Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "signals-and-systems-full-notes"
source_file: "Signals and Systems full notes.pdf"
locations: ["Page 11"]
related: ["sinusoidal-amplitude-modulation", "continuous-time-sinusoidal-signal-parameters", "spectrum-representation-of-sums-of-sinusoids"]
tags: ["product-to-sum-identity", "zero-crossings", "amplitude-modulation", "cosine", "phase"]
source_images: ["/signals-and-systems/assets/signals-and-systems-full-notes-page-011.png"]
---

## Product-to-Sum Method for Zero Crossings

Source: [[signals-and-systems-full-notes|Signals and Systems Full Notes: Sinusoids, Spectra, Sampling, Aliasing, and FIR Filters]]

Locations: Page 11

The notes demonstrate a reusable procedure for finding zero crossings of a sum of cosines by rewriting the sum as a product. The identity used is $\cos(\omega_mt+\phi_m)\cos(\omega_ct+\phi_c)=\frac{1}{2}[\cos((\omega_m+\omega_c)t+(\phi_m+\phi_c))+\cos((\omega_c-\omega_m)t+(\phi_c-\phi_m))]$. Given $x(t)=\frac{1}{2}\cos(10\pi t-\pi/3)+\frac{1}{2}\cos(5\pi t-2\pi/3)$, the notes choose carrier and message terms so the sum becomes $x(t)=\cos(10\pi t-\pi/4)\cos(5\pi t+5\pi/12)$. Because a product is zero when either factor is zero, one can solve $\cos(10\pi t-\pi/4)=0$ or $\cos(5\pi t+5\pi/12)=0$. The worked solutions give $t=3/40\text{ s}$ and $t=1/12\text{ s}$ for the shown zero-crossing cases. This method is useful when the product form exposes simple zero conditions.

### Source snapshots

![Signals and Systems full notes Page 11](/signals-and-systems/assets/signals-and-systems-full-notes-page-011.png)

### Page-grounded details

#### Page 11

hey given the signal  x(t)= 1/2 cos(10πt - π/3) + 1/2 cos(5πt - 2π/3) when
will its smart cross the x axis to boot?

Solution We can squite this as a product, using amplitude modulation.
since we are looking for x(t)=0 product might be very simple.

x(t) = 1/2 ( e^(j10πt) * e^(-jπ/3) + e^(j5πt) * e^(-j2π/3) )

we can use the following identity:

*  cos(ωmt + φm) cos(ωct + φc) = 1/2 [ cos((ωm+ωc)t + (φm+φc)) + cos((ωc-ωm)t + (φc-φm)) ]

(To make x(t) contains the sum of the phases, lower should indicate the difference
of the phases)

- ωc + ωm = 15πt ,   ωc = 10πt ^ ωm = 5πt
  ωc - ωm = 5πt

- φm + φc = π/6 ,   φc = -π/4  ^ φm = 5π/12
  φc - φm = -2π/3

∴ x(t) = cos(10πt - π/4) * cos(5πt + 5π/12)

[underbrace/brace labels under first factor: 0]   [underbrace/brace labels under second factor: 0]

cos(10πt - π/4) = 0       V       cos(5πt + 5π/12) = 0

10πt - π/4 = π/2                  5πt + 5π/12 = π/2

t = 3/40 s                         t = 1/12 s

12

### Key points

- A sum of two cosines can sometimes be rewritten as a product
- The product-to-sum identity relates product frequencies to sum and difference frequencies
- The phases must be chosen so one component contains phase sum and the other phase difference
- The example sum becomes $\cos(10\pi t-\pi/4)\cos(5\pi t+5\pi/12)$
- A product equals zero when either factor equals zero
- Solving the first factor gives $t=3/40\text{ s}$
- Solving the second factor gives $t=1/12\text{ s}$
- This procedure uses amplitude modulation structure to simplify zero-crossing analysis

### Related topics

- [[sinusoidal-amplitude-modulation|Sinusoidal Amplitude Modulation]]
- [[continuous-time-sinusoidal-signal-parameters|Continuous-Time Sinusoidal Signal Parameters]]
- [[spectrum-representation-of-sums-of-sinusoids|Spectrum Representation of Sums of Sinusoids]]

### Relationships

- example-of: [[sinusoidal-amplitude-modulation|Sinusoidal Amplitude Modulation]]
