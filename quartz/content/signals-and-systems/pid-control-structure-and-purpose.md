---
title: "PID Control Structure and Purpose"
date: "2026-04-30T16:26:39.261Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "signals-and-systems-full-notes"
source_file: "Signals and Systems full notes.pdf"
locations: ["Page 112", "Page 113"]
related: ["disturbance-rejection", "system-type-for-reference-tracking", "proportional-control-and-large-loop-gain", "pid-effects-on-step-response"]
tags: ["pid-control", "proportional", "integral", "derivative"]
---

## PID Control Structure and Purpose

Source: [[signals-and-systems-full-notes|Signals and Systems Full Notes: Sinusoids, Spectra, Sampling, Aliasing, and FIR Filters]]

Locations: Page 112, Page 113

PID control is introduced after tracking and disturbance rejection because a controller must meet two design goals simultaneously. At low frequencies, it must shape the loop transfer function to achieve the desired system type and eliminate steady-state errors. At higher frequencies, it must shape closed-loop dynamics to obtain acceptable transient behavior such as settling speed, rise time, overshoot, and damping. The PID controller is presented as the simplest controller structure that combines these roles. Its input error $E(s)$ is split into three parallel paths: proportional $K_p$, integral $K_i/s$, and derivative $K_Ds$, and the outputs are summed to form $U(s)$. The full PID transfer function is $D(s)=K_p+K_i/s+K_Ds$. The notes say several tuning methods exist for $K_P$, $K_I$, and $K_D$, with heuristic tuning described as a popular clever guess-and-check method.

### Page-grounded details

#### Page 112

2) Disturbance rejection: refers to the ability of a system to prevent
unwanted external signals from affecting its output, in steady state or
transient, over time

When disturbance enters the system, the steady state effect of the
disturbance on the output depends on the system type in a very similar
way as with reference tracking

To calculate steady state error caused by a disturbance, set the
reference zero and the disturbance, the polynomial inputs we did such as
step input, ramp input and Parabola input to determine the system type

[block diagram]
r -> summing junction (+ from r, - feedback from y) -> e -> controller
D(s) -> u -> plant G(s) -> summing junction (+ from plant, + from disturbance)
-> y
disturbance path: w -> H(s) -> downward arrow into output summing junction
feedback path: y loops back to input summing junction

Twy = H(s) / (1 + D(s)G(s))        w

Control system of type k for disturbance rejection if and only if

lim sE(s) = - H(s) / (1 + D(s)G(s))  1/s^k  = K != 0.
s->0


2.5 PID Control

Once the role of feedback is tracking and disturbance rejection as
understood, the next question is how the controller D(s) should be chosen
practice.

From the previous a

[Truncated for analysis]

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

- Low-frequency controller behavior affects system type and steady-state error.
- Higher-frequency controller behavior affects transient response.
- Transient metrics include rise time, overshoot, settling time, and damping.
- PID has proportional, integral, and derivative paths in parallel.
- The proportional action is $U(s)=K_pE(s)$.
- The integral action is $U(s)=K_iE(s)/s$.
- The derivative action is $U(s)=K_DsE(s)$.
- The full PID controller is $D(s)=K_p+K_i/s+K_Ds$.

### Related topics

- [[disturbance-rejection|Disturbance Rejection]]
- [[system-type-for-reference-tracking|System Type for Reference Tracking]]
- [[proportional-control-and-large-loop-gain|Proportional Control and Large Loop Gain]]
- [[pid-effects-on-step-response|PID Effects on Step Response]]

### Relationships

- part-of: [[pid-effects-on-step-response|PID Effects on Step Response]]
