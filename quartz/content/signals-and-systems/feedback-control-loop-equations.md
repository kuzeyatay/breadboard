---
title: "Feedback Control Loop Equations"
date: "2026-04-30T16:26:39.261Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "signals-and-systems-full-notes"
source_file: "Signals and Systems full notes.pdf"
locations: ["Page 105", "Page 106"]
related: ["standard-negative-and-positive-feedback-transfer-functions", "limitations-of-feedforward-control", "proportional-control-and-large-loop-gain", "reference-tracking-and-steady-state-error", "disturbance-rejection", "closed-loop-responses-to-reference-disturbance-and-sensor-noise"]
tags: ["feedback-control", "error-signal", "controller", "plant", "closed-loop-transfer-function", "control-effort"]
---

## Feedback Control Loop Equations

Source: [[signals-and-systems-full-notes|Signals and Systems Full Notes: Sinusoids, Spectra, Sampling, Aliasing, and FIR Filters]]

Locations: Page 105, Page 106

Feedback control measures the actual output and adjusts the input based on the error between desired and measured behavior. The error signal is defined as $e(t)=r(t)-y(t)$ for the basic unity feedback case, and the controller generates $u(t)$ as a function of this error. If the output is smaller than desired, the error is positive and the controller increases the input; if the output is too large, the controller reduces the input. In the Laplace-domain feedback loop with controller $D(s)$ and plant $G(s)$, the closed-loop output response is $Y(s)=\frac{D(s)G(s)}{1+D(s)G(s)}R(s)$. The control effort and error relative to the reference are $U(s)=\frac{D(s)}{1+D(s)G(s)}R(s)$ and $E(s)=\frac{1}{1+D(s)G(s)}R(s)$. The closed-loop transfer function is $T(s)=D(s)G(s)/(1+D(s)G(s))$.

### Page-grounded details

#### Page 105

Despite its apparent simplicity, this approach is fundamentally flawed in
practice. Understanding why it fails is the central motivation for feedback
control.

The first difficulty arises from the fact that the system model G(s) is never
known exactly. Any real physical system is subject to unmodeled dynamics,
parameter variations, aging effects, and approximations introduced during modeling
and linearization. As a result, the true system differs from the model and
the algebraic cancellation does not occur.

A second more fundamental limitation concerns stability and realizability. If the
system G(s) has zeros in the RHP, time delays, or non minimum phase behaviour,
then its inverse G⁻^1(s) will typically be unstable or non-causal. Therefore
its inverse may not be implemented in any meaningful way.

The most severe limitation of feedforward control arises in the presence
of disturbances. Real systems are never isolated; they are affected by
external inputs such as disturbance loads, noise, and environmental influences.
If a disturbance signal d(t) enters the system additively at the output, the
true system behaviour becomes:

y(t) = g(t) * u(t) + d(t)

[diagram: boxed block diagram

[Truncated for analysis]

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

- Feedback control continuously measures output and adjusts input.
- The basic error is $e(t)=r(t)-y(t)$.
- The controller input is the error signal $E(s)$.
- The closed-loop reference-to-output transfer is $Y/R=DG/(1+DG)$.
- The reference-to-control transfer is $U/R=D/(1+DG)$.
- The reference-to-error transfer is $E/R=1/(1+DG)$.

### Related topics

- [[standard-negative-and-positive-feedback-transfer-functions|Standard Negative and Positive Feedback Transfer Functions]]
- [[limitations-of-feedforward-control|Limitations of Feedforward Control]]
- [[proportional-control-and-large-loop-gain|Proportional Control and Large Loop Gain]]
- [[reference-tracking-and-steady-state-error|Reference Tracking and Steady-State Error]]
- [[disturbance-rejection|Disturbance Rejection]]
- [[closed-loop-responses-to-reference-disturbance-and-sensor-noise|Closed-Loop Responses to Reference Disturbance and Sensor Noise]]

### Relationships

- applies-to: [[proportional-control-and-large-loop-gain|Proportional Control and Large Loop Gain]]
- depends-on: [[reference-tracking-and-steady-state-error|Reference Tracking and Steady-State Error]]
- part-of: [[closed-loop-responses-to-reference-disturbance-and-sensor-noise|Closed-Loop Responses to Reference Disturbance and Sensor Noise]]
