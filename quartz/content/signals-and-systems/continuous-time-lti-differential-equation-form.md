---
title: "Continuous-Time LTI Differential Equation Form"
date: "2026-04-30T16:26:39.261Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "signals-and-systems-full-notes"
source_file: "Signals and Systems full notes.pdf"
locations: ["Page 64"]
related: ["continuous-time-lti-system-properties", "dirac-delta-distribution", "second-order-linear-constant-coefficient-equations"]
tags: ["continuous-time-lti-systems", "differential-equations", "operator-form", "input-output", "convolution"]
---

## Continuous-Time LTI Differential Equation Form

Source: [[signals-and-systems-full-notes|Signals and Systems Full Notes: Sinusoids, Spectra, Sampling, Aliasing, and FIR Filters]]

Locations: Page 64

Finite-dimensional continuous-time LTI systems in the notes are governed by constant-coefficient differential equations relating input $u(t)$ and output $y(t)$. The general form is $a_ny^{(n)}(t)+\cdots+a_0y(t)=b_mu^{(m)}(t)+\cdots+b_0u(t)$, where the coefficients are real scalar constants and the input and output are real-valued functions of time. In operator form, this becomes $L[y]=R[u]$, matching the earlier operator view of differential equations. The notes explicitly connect this to discrete-time LTI systems: in discrete time, the system was defined by convolution of the input with the discrete impulse response; in continuous time, a similar idea applies using a continuous-time impulse. This prepares the introduction of the Dirac delta distribution and continuous-time impulse response.

### Page-grounded details

#### Page 64

In this notebook, we are going to look at finite dimensional continuous
time LTI systems that satisfies the properties we discussed and governed
by differential equations of the form

aₙ y⁽ⁿ⁾(t) + ... + a_0 y(t) = bₘ u⁽ᵐ⁾(t) + ... + b_0 u(t)

where a_0... aₙ and b_0...bₘ are real scalar valued constants and
u(t) and y(t), are real scalar valued functions of time t

In operator form this is

L[y] = R[u]


Now, lets take a step back. In discrete time LTI systems, we had the
convolution sum that defined the system, which was convolution of
the discrete impulse response and a discrete time system. A similar idea
applies to continuous time systems.

-> Dirac delta Distribution (continuous time impulse) (δ(x))

The Dirac delta is not an ordinary function in the classical
sense, it can be visualized as:

[diagram: rectangular pulse centered around vertical y-axis, width marked Δ on x-axis, height marked 1/Δ, area labeled "area 1"]

-> think of this rectangle,
it always has area 1
no matter the value of
Δ. however, if we
shrink Δ down to be
infinitesimally small
we get an infinitely tall
spike, but with that same
area of 1 under it

[diagram: limiting impulse spike at x=0, vertical arrow u

[Truncated for analysis]

### Key points

- Finite-dimensional continuous-time LTI systems are governed by differential equations.
- The coefficients $a_0,\ldots,a_n$ and $b_0,\ldots,b_m$ are real constants.
- The input is $u(t)$ and the output is $y(t)$.
- The general equation relates derivatives of output to derivatives of input.
- Operator form is $L[y]=R[u]$.
- Continuous-time convolution is introduced as analogous to discrete-time convolution.

### Related topics

- [[continuous-time-lti-system-properties|Continuous-Time LTI System Properties]]
- [[dirac-delta-distribution|Dirac Delta Distribution]]
- [[second-order-linear-constant-coefficient-equations|Second-Order Linear Constant-Coefficient Equations]]

### Relationships

- depends-on: [[continuous-time-lti-system-properties|Continuous-Time LTI System Properties]]
- related: [[second-order-linear-constant-coefficient-equations|Second-Order Linear Constant-Coefficient Equations]]
