---
title: "Routh Hurwitz Cubic Stability Condition"
date: "2026-04-30T16:26:39.261Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "signals-and-systems-full-notes"
source_file: "Signals and Systems full notes.pdf"
locations: ["Page 109", "Page 108"]
related: ["closed-loop-characteristic-equation-and-controller-design", "reference-tracking-and-steady-state-error", "steady-state-error-examples-for-step-ramp-and-parabolic-inputs"]
tags: ["routh-hurwitz", "characteristic-polynomial", "stability", "closed-loop-system", "final-value-theorem"]
---

## Routh Hurwitz Cubic Stability Condition

Source: [[signals-and-systems-full-notes|Signals and Systems Full Notes: Sinusoids, Spectra, Sampling, Aliasing, and FIR Filters]]

Locations: Page 109, Page 108

Page 109 gives the Routh-Hurwitz stability condition for a third-degree characteristic polynomial. For a cubic polynomial $P(s)=s^3+a_2s^2+a_1s+a_0$, the stated conditions require all three coefficients $a_2$, $a_1$, and $a_0$ to be positive and also require the product $a_2a_1$ to be greater than $a_0$. In the broader context of the notes, these conditions are relevant because controller design changes the characteristic equation and therefore the closed-loop poles. Stability is a prerequisite for applying steady-state tracking formulas such as the final value theorem. The page is marked as occasionally slipped out of order, but it still supplies a durable stability test used alongside closed-loop characteristic equations and system type analysis.

### Page-grounded details

#### Page 108

However, we still have two problems we need to solve; The reference
tracking problem and disturbance rejection problem, which are two
metrics we care about

1) Reference tracking.

In feedback control, one of the critical performance questions is not only
whether a system is stable, but how accurately it can follow a desired
reference signal. In steady state, even when a closed loop system is stable,
the output may differ from the reference by a constant, or slowly varying
factor. Understanding when this error is zero, finite or unbounded
is the purpose of the concept know as system type with respect to
reference tracking.

Consider the feedback configuration:

T(s) = DG / 1 + DG

E(s) = 1 / 1 + DG * R

[Diagram: negative-feedback block diagram. Reference input R(s) enters a summing junction with "+" on the reference input and "-" on the feedback input. The output of the summing junction is labeled E(s), then passes through a controller block labeled D(s). The controller output is labeled U(s), then passes through a plant block labeled G(s). The output is labeled Y(s), and is fed back along a line to the negative input of the summing junction.]

The quantity of interest is the stea

[Truncated for analysis]

#### Page 109

[Occasionally, slipped these two pages] :(

-> for a characteristic polynomial of degree 3:  P(s) = s^3 + a_2s^2 + a_1s + a_0
the Routh Hurwitz condition is

[boxed]
a_2 > 0
a_1 > 0
a_0 > 0
a_2a_1 > a_0

### Key points

- The cubic characteristic polynomial is $P(s)=s^3+a_2s^2+a_1s+a_0$.
- The Routh-Hurwitz conditions include $a_2>0$.
- The conditions include $a_1>0$.
- The conditions include $a_0>0$.
- The additional cubic condition is $a_2a_1>a_0$.
- Closed-loop stability must be checked before using the final value theorem.

### Related topics

- [[closed-loop-characteristic-equation-and-controller-design|Closed-Loop Characteristic Equation and Controller Design]]
- [[reference-tracking-and-steady-state-error|Reference Tracking and Steady-State Error]]
- [[steady-state-error-examples-for-step-ramp-and-parabolic-inputs|Steady-State Error Examples for Step Ramp and Parabolic Inputs]]

### Relationships

- depends-on: [[reference-tracking-and-steady-state-error|Reference Tracking and Steady-State Error]]
