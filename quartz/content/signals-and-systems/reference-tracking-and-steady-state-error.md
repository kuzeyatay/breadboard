---
title: "Reference Tracking and Steady-State Error"
date: "2026-04-30T16:26:39.261Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "signals-and-systems-full-notes"
source_file: "Signals and Systems full notes.pdf"
locations: ["Page 108", "Page 110"]
related: ["feedback-control-loop-equations", "system-type-for-reference-tracking", "steady-state-error-examples-for-step-ramp-and-parabolic-inputs", "proportional-control-and-large-loop-gain"]
tags: ["reference-tracking", "steady-state-error", "final-value-theorem", "step-reference", "ramp-reference", "parabolic-reference"]
---

## Reference Tracking and Steady-State Error

Source: [[signals-and-systems-full-notes|Signals and Systems Full Notes: Sinusoids, Spectra, Sampling, Aliasing, and FIR Filters]]

Locations: Page 108, Page 110

Reference tracking asks how accurately a stable feedback system follows a desired input in steady state. The notes focus on polynomial reference signals because they include common practical references: step, ramp, and parabolic inputs. In a unity feedback loop, the closed-loop transfer is $T(s)=DG/(1+DG)$ and the error response is $E(s)=\frac{1}{1+DG}R(s)$. The steady-state tracking error is found using the final value theorem, provided the closed-loop system is stable: $\lim_{t\to\infty} e(t)=\lim_{s\to 0}sE(s)$. Polynomial references are represented as $r(t)=t^k/k!$, with Laplace transform $R(s)=1/s^{k+1}$. Thus step has $k=0$ and $R(s)=1/s$, ramp has $k=1$ and $R(s)=1/s^2$, and parabolic has $k=2$ and $R(s)=1/s^3$. Substitution shows the low-frequency behavior of $D(s)G(s)$ determines steady-state error.

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

#### Page 110

These signals are often described informally as having increased "velocity",
meaning that each successive signal grows faster with time.

The fundamental question is, under what conditions can a feedback system
track these reference inputs with zero steady state error.

Substituting R(s) = 1/s^(k+1) to the error expression yields.

lim t->∞ e(t) = lim s->0 sE(s) = lim s->0 s * 1/(1 + D(s)G(s)) * 1/s^(k+1) = lim s->0 1/((1 + D(s)G(s))s^k)

∴ the behavior of the steady state error is entirely determined by
the low frequency (small-s) behaviour of the loop transfer function
D(s)G(s)

This leads to the definition of system type. A feedback system is said to
be of system type n with respect to reference tracking if the
following properties hold:

- For a reference input, r(t) = t^n/n!, the steady state is finite and zero

- For all reference inputs of lower degree, r(t) = t^k/k!, with 0 <= k < n
  the steady state error is zero.

- For reference inputs of higher degree, r(t) = t^k/k!, with k > n,
  the steady state error is infinite.

-> This classification is not arbitrary, it follows directly from the
  behaviour of D(s)G(s) near s = 0. Specifically, a system is type
  n if and only i

[Truncated for analysis]

### Key points

- Reference tracking measures how well output follows a desired reference.
- The error transfer is $E(s)=\frac{1}{1+DG}R(s)$.
- Steady-state error uses $\lim_{t\to\infty}e(t)=\lim_{s\to0}sE(s)$.
- Polynomial references are $r(t)=t^k/k!$ and $R(s)=1/s^{k+1}$.
- Step reference: $k=0$, $R(s)=1/s$, $r(t)=1(t)$.
- Ramp reference: $k=1$, $R(s)=1/s^2$, $r(t)=t$.
- Parabolic reference: $k=2$, $R(s)=1/s^3$, $r(t)=t^2/2$.
- Low-frequency behavior of $D(s)G(s)$ determines steady-state tracking error.

### Related topics

- [[feedback-control-loop-equations|Feedback Control Loop Equations]]
- [[system-type-for-reference-tracking|System Type for Reference Tracking]]
- [[steady-state-error-examples-for-step-ramp-and-parabolic-inputs|Steady-State Error Examples for Step Ramp and Parabolic Inputs]]
- [[proportional-control-and-large-loop-gain|Proportional Control and Large Loop Gain]]

### Relationships

- depends-on: [[system-type-for-reference-tracking|System Type for Reference Tracking]]
- applies-to: [[steady-state-error-examples-for-step-ramp-and-parabolic-inputs|Steady-State Error Examples for Step Ramp and Parabolic Inputs]]
