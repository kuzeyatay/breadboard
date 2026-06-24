---
title: "PID Effects on Step Response"
date: "2026-04-30T16:26:39.261Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "signals-and-systems-full-notes"
source_file: "Signals and Systems full notes.pdf"
locations: ["Page 113"]
related: ["pid-control-structure-and-purpose", "reference-tracking-and-steady-state-error", "closed-loop-characteristic-equation-and-controller-design"]
tags: ["pid-effects", "step-response", "rise-time", "overshoot", "settling-time", "steady-state-error"]
---

## PID Effects on Step Response

Source: [[signals-and-systems-full-notes|Signals and Systems Full Notes: Sinusoids, Spectra, Sampling, Aliasing, and FIR Filters]]

Locations: Page 113

Page 113 summarizes the qualitative effects of increasing proportional, integral, and derivative gains on step response metrics. Increasing $K_P$ decreases rise time, increases overshoot, causes only a small change in settling time, and decreases steady-state error. Increasing $K_I$ also decreases rise time and decreases steady-state error, but it increases both overshoot and settling time. Increasing $K_D$ has only a small effect on rise time, decreases overshoot, decreases settling time, and causes no change in steady-state error. These relationships are presented as a tuning guide rather than exact formulas. The notes clarify that tuning methods mean finding actual values for $K_P$, $K_I$, and $K_D$, and mention heuristic tuning as the most popular approach.

### Page-grounded details

#### Page 113

A controller must therefore serve two distinct purposes simultaneously.
At low frequencies, it must shape the loop transfer function to achieve the
desired system type and eliminate steady-state errors. At higher frequencies, it
must shape the closed-loop dynamics to obtain acceptable transient behaviour. The
proportional-integral-derivative (PID) controller is the simplest controller
structure that achieves this. (we have seen just the proportional control before).

[Diagram: input labeled `E` enters a dashed box labeled `D(s)`. The input splits into three parallel paths:
top block `Kp`, middle block `Ki/s`, bottom block `KD*s`. The three outputs feed a summing junction with `+ + +`, producing output labeled `U`.]

► Proportional (P): `U(s) = Kp E(s)`

► Integral (I): `U(s) = Ki/s * E(s)`

► Derivative (D) -> `U(s) = KD s E(s)`

 deg Full PID: [boxed] `D(s) = Kp + Ki/s + KD s`

There exists several tuning methods for `KP`, `KI`, `KD`, but the
most popular one is heuristic tuning, which is just clever guess and check

PID effects on step response:

|      | Rise time | Overshoot | Settling time | Steady-State error |
|------|-----------|-----------|---------------|-----------------

[Truncated for analysis]

### Key points

- $K_P$ decreases rise time.
- $K_P$ increases overshoot.
- $K_P$ causes small change in settling time and decreases steady-state error.
- $K_I$ decreases rise time but increases overshoot.
- $K_I$ increases settling time and decreases steady-state error.
- $K_D$ causes small change in rise time.
- $K_D$ decreases overshoot and settling time.
- $K_D$ causes no change in steady-state error.

### Related topics

- [[pid-control-structure-and-purpose|PID Control Structure and Purpose]]
- [[reference-tracking-and-steady-state-error|Reference Tracking and Steady-State Error]]
- [[closed-loop-characteristic-equation-and-controller-design|Closed-Loop Characteristic Equation and Controller Design]]

### Relationships

- related: [[closed-loop-characteristic-equation-and-controller-design|Closed-Loop Characteristic Equation and Controller Design]]
