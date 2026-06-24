---
title: "Continuous-Time LTI System Properties"
date: "2026-04-30T16:26:39.261Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "signals-and-systems-full-notes"
source_file: "Signals and Systems full notes.pdf"
locations: ["Page 62", "Page 63"]
related: ["discrete-time-linearity-and-time-invariance", "continuous-time-lti-differential-equation-form", "dirac-delta-distribution"]
tags: ["continuous-time-lti-systems", "siso", "linearity", "time-invariance", "causality", "dynamical-systems"]
---

## Continuous-Time LTI System Properties

Source: [[signals-and-systems-full-notes|Signals and Systems Full Notes: Sinusoids, Spectra, Sampling, Aliasing, and FIR Filters]]

Locations: Page 62, Page 63

The notes introduce continuous-time LTI systems as single-input single-output systems that transform time functions into other time functions. Engineering is described as the science of transforming signals, where a continuous-time signal is a function of time carrying information and a system is a physical or computational mechanism that manipulates it. Physical systems evolve in time and store energy, so they have memory and are modeled as dynamical systems by differential equations. A continuous-time LTI mapping $T$ sends functions of time to functions of time and satisfies linearity and time invariance. Linearity consists of homogeneity and additivity: scaling the input scales the output, and adding inputs adds outputs. Time invariance means delaying the input by $T$ delays the output by the same amount. Causality means the output depends only on present and past input values, so if $u(t)=0$ for all $t<0$, then $y(t)=0$ for all $t<0$.

### Page-grounded details

#### Page 62

! It is very important to note that the variation of parameters method only
works when the forcing term has a nice form eg:

- Polynomials

- Exponentials

- Sines and cosines

- Products of above

Finally the system representation clarifies why initial value problems are naturally
posed with two conditions for a second order equation, specifying y(t_0) and y'(t_0).
For the non homogeneous system [Ẋ] = AX + G(t), specifying y(t_0) and y'(t_0)
is exactly specifying the initial state x(t_0) ∈ R^2

Chapter 2: Modeling Systems

2.1 Continous LTI systems

Engineering is fundamentally the science of transforming signals. A signal,
in continuous time domain is a function of time that carries information and is
defined everywhere. In a new while a system is a physical or computational
mechanism that manipulates the signal. Because physical systems evolve in
time and store energy, they cause memory. Such systems are called dynamical
systems and their behaviour is described by differential equations.

In this notebook, we focus on single-input single-output (SISO) continuous
time linear invariant systems, because they admit a powerful mathematical
theory that allows prediction design and co

[Truncated for analysis]

#### Page 63

1) Linearity: A system is linear if it satisfies the principle of
superposition. this consists of two parts:

1.a) Homogeneity means that, if input u(t) produces an output y(t),
then scaling the input by any constant α scales the output by the
same factor.

[boxed] u(t) ↔ y(t) -> α*u(t) ↔ α*y(t) [/boxed]

1.b) Additivity means that, if u_1(t) produces y_1(t) and u_2(t) produces y_2(t),
then applying both inputs simultaneously produces the sum of the outputs.

u_1(t) + u_2(t) ↔ y_1(t) + y_2(t)

Homogeneity                         Additivity                         Superposition
[diagram: input u -> boxed "LTI" -> output y]
input αu -> [same boxed "LTI"] -> output αy

[diagram: input u_1 -> boxed "LTI" -> output y_1
input u_2 -> boxed "LTI" -> output y_2]

[diagram: input α_1u_1 + α_2u_2 -> boxed "LTI" -> output α_1y_1 + α_2y_2]


2) Time Invariance: A system is time invariant if its behavior does not depend
on when an input is applied. If input u(t) produces output y(t), then delaying
the input by T produces the same delayed output.

u(t - T) ↔ y(t - T)

This property holds only if the parameters of the system are constant
in time. If coefficient in a system defined by differential

[Truncated for analysis]

### Key points

- A continuous-time signal is a function of time that carries information.
- A system manipulates a signal.
- Dynamical systems store energy and are described by differential equations.
- Linearity includes homogeneity and additivity.
- Time invariance means $u(t-T)$ produces $y(t-T)$.
- Causality means no response occurs before excitation.

### Related topics

- [[discrete-time-linearity-and-time-invariance|Discrete-Time Linearity and Time Invariance]]
- [[continuous-time-lti-differential-equation-form|Continuous-Time LTI Differential Equation Form]]
- [[dirac-delta-distribution|Dirac Delta Distribution]]

### Relationships

- related: [[discrete-time-linearity-and-time-invariance|Discrete-Time Linearity and Time Invariance]]
