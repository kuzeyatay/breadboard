---
title: "Proportional Control and Large Loop Gain"
date: "2026-04-30T16:26:39.261Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "signals-and-systems-full-notes"
source_file: "Signals and Systems full notes.pdf"
locations: ["Page 106"]
related: ["feedback-control-loop-equations", "open-loop-inverse-control", "reference-tracking-and-steady-state-error", "pid-control-structure-and-purpose"]
tags: ["proportional-control", "loop-gain", "setpoint", "error-signal"]
---

## Proportional Control and Large Loop Gain

Source: [[signals-and-systems-full-notes|Signals and Systems Full Notes: Sinusoids, Spectra, Sampling, Aliasing, and FIR Filters]]

Locations: Page 106

After deriving the basic feedback equations, the notes introduce proportional control as a simple controller choice. A proportional controller is defined by $D(s)=K_p$. For the unity feedback loop with plant $G(s)$ and controller $D(s)$, the main transfer functions are $Y(s)/R(s)=D(s)G(s)/(1+D(s)G(s))$, $E(s)/R(s)=1/(1+G(s)D(s))$, and $U(s)/R(s)=D(s)/(1+G(s)D(s))$. These formulas show that to make the output approximately equal to the setpoint and the error approximately zero, the loop magnitude $|G(s)D(s)|$ should be large. When $|D(s)G(s)|=|K_pG(s)| \gg 1$, the loop makes the input behave approximately as if it were produced by an inverse of $G$, since $U(s)/R(s) \approx 1/G(s)$. The notes emphasize that in practice the loop gain may need to be very large, such as hundreds or thousands.

### Page-grounded details

#### Page 106

if the output is smaller than desired, the error is positive and the controller
increases the input; if the output is too large, the controller reduces the input.
This simple principle of continuously correcting deviations between desired and actual
behaviour is the foundational idea of control.

a feedback control loop can be modeled as:

R(s) -> (+)○(-) -> E(s) -> [controller
D(s)] -> U(s) -> [Plant
G(s)] -> Y(s)
                                                     ↲─────────────── feedback to - input of summing junction

Y = DG / 1+DG R
U = D / 1+DG R
E = 1 / 1+DG R

-> same diagram older appear in another
pass through
which block
to get there,
this means could
give you way of Y(s) to the
deduce closed loop tf
then denom would
be 1+DGH

From the previous section, we already know that:

┌─────────────────────────────────────┐
│ Y(s) = R(s) D(s) G(s) / 1 + D(s)G(s) │
└─────────────────────────────────────┘

with T(s) = D(s).G(s) / 1 + D(s)G(s)

E(s) = R(s) - Y(s)

The question now is, what is our controller D(s)? how do we
choose the parameters, we have talked about would a lot. To answer this,
we introduce a simple type of control called proportional control,
defined as: D(s)=Kp

[Truncated for analysis]

### Key points

- Proportional control is defined as $D(s)=K_p$.
- The output transfer is $Y/R=DG/(1+DG)$.
- The error transfer is $E/R=1/(1+GD)$.
- The control-effort transfer is $U/R=D/(1+GD)$.
- Good tracking requires $Y/R \approx 1$ and $E/R \approx 0$.
- These approximations occur when $|G(s)D(s)|$ is large.

### Related topics

- [[feedback-control-loop-equations|Feedback Control Loop Equations]]
- [[open-loop-inverse-control|Open-Loop Inverse Control]]
- [[reference-tracking-and-steady-state-error|Reference Tracking and Steady-State Error]]
- [[pid-control-structure-and-purpose|PID Control Structure and Purpose]]

