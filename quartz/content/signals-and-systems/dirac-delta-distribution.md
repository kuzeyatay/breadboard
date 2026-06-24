---
title: "Dirac Delta Distribution"
date: "2026-04-30T16:26:39.261Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "signals-and-systems-full-notes"
source_file: "Signals and Systems full notes.pdf"
locations: ["Page 64"]
related: ["continuous-time-lti-differential-equation-form", "continuous-time-lti-system-properties", "discrete-unit-impulse-sequence"]
tags: ["dirac-delta", "continuous-time-impulse", "distribution", "impulse-response"]
flag_color: "#fb7185"
---

## Dirac Delta Distribution

Source: [[signals-and-systems-full-notes|Signals and Systems Full Notes: Sinusoids, Spectra, Sampling, Aliasing, and FIR Filters]]

Locations: Page 64

The Dirac delta distribution is introduced as the continuous-time impulse, analogous in role to the discrete unit impulse but not an ordinary classical function. The notes visualize it as a rectangle centered at the origin with width $\Delta$ and height $1/\Delta$, so its area is always one. As $\Delta$ shrinks toward zero, the rectangle becomes an infinitely narrow and infinitely tall spike while preserving area one. This limiting object is the Dirac delta. It is defined by the integral condition $\int_{-\infty}^{\infty}\delta(x)\,dx=1$. Heuristically, the notes write that $\delta(x)=0$ for $x\neq0$ and $\delta(x)=\infty$ for $x=0$, while emphasizing that it is not an ordinary function. This concept supports the extension of impulse-response and convolution ideas from discrete-time LTI systems to continuous-time LTI systems.

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

- The Dirac delta is the continuous-time impulse.
- It is not an ordinary function in the classical sense.
- It can be visualized as a rectangle of width $\Delta$ and height $1/\Delta$.
- The rectangle's area remains one for any $\Delta$.
- As $\Delta\to0$, the rectangle becomes an infinitely tall spike.
- The defining condition is $\int_{-\infty}^{\infty}\delta(x)\,dx=1$.

### Related topics

- [[continuous-time-lti-differential-equation-form|Continuous-Time LTI Differential Equation Form]]
- [[continuous-time-lti-system-properties|Continuous-Time LTI System Properties]]
- [[discrete-unit-impulse-sequence|Discrete Unit Impulse Sequence]]

### Relationships

- depends-on: [[continuous-time-lti-differential-equation-form|Continuous-Time LTI Differential Equation Form]]
- related: [[discrete-unit-impulse-sequence|Discrete Unit Impulse Sequence]]
