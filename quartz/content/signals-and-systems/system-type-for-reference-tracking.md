---
title: "System Type for Reference Tracking"
date: "2026-04-30T16:26:39.261Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "signals-and-systems-full-notes"
source_file: "Signals and Systems full notes.pdf"
locations: ["Page 110"]
related: ["reference-tracking-and-steady-state-error", "steady-state-error-examples-for-step-ramp-and-parabolic-inputs", "disturbance-rejection", "pid-control-structure-and-purpose"]
tags: ["system-type", "reference-tracking", "steady-state-error"]
---

## System Type for Reference Tracking

Source: [[signals-and-systems-full-notes|Signals and Systems Full Notes: Sinusoids, Spectra, Sampling, Aliasing, and FIR Filters]]

Locations: Page 110

System type classifies the steady-state tracking capability of a feedback system for polynomial reference inputs. Starting from $E(s)=\frac{1}{1+D(s)G(s)}R(s)$ and $R(s)=1/s^{k+1}$, the final value theorem gives $e_{ss}=\lim_{s\to0}1/[(1+D(s)G(s))s^k]$. Therefore the small-$s$ behavior of the loop transfer $D(s)G(s)$ determines whether steady-state error is zero, finite, or infinite. A system is type $n$ with respect to reference tracking if it has zero steady-state error for all polynomial inputs of degree lower than $n$, finite nonzero error for $r(t)=t^n/n!$, and infinite error for higher-degree polynomial inputs. Equivalently, the system is type $n$ if $\lim_{s\to0}s^nD(s)G(s)=K_n\ne0$, where $K_n$ is finite. The notes summarize type 0, 1, and 2 using position, velocity, and acceleration constants $K_p$, $K_v$, and $K_a$.

### Page-grounded details

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

- The steady-state error for $R(s)=1/s^{k+1}$ is $\lim_{s\to0}1/[(1+DG)s^k]$.
- System type is determined by the number of low-frequency integrators in $D(s)G(s)$.
- Type $n$ has zero error for polynomial inputs of degree lower than $n$.
- Type $n$ has finite nonzero error for $r(t)=t^n/n!$.
- Type $n$ has infinite error for polynomial inputs of degree greater than $n$.
- The defining condition is $\lim_{s\to0}s^nD(s)G(s)=K_n\ne0$.
- $K_p=\lim_{s\to0}D(s)G(s)$, $K_v=\lim_{s\to0}sD(s)G(s)$, and $K_a=\lim_{s\to0}s^2D(s)G(s)$.

### Related topics

- [[reference-tracking-and-steady-state-error|Reference Tracking and Steady-State Error]]
- [[steady-state-error-examples-for-step-ramp-and-parabolic-inputs|Steady-State Error Examples for Step Ramp and Parabolic Inputs]]
- [[disturbance-rejection|Disturbance Rejection]]
- [[pid-control-structure-and-purpose|PID Control Structure and Purpose]]

### Relationships

- applies-to: [[steady-state-error-examples-for-step-ramp-and-parabolic-inputs|Steady-State Error Examples for Step Ramp and Parabolic Inputs]]
- related: [[pid-control-structure-and-purpose|PID Control Structure and Purpose]]
