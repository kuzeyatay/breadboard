---
title: "Limitations of Feedforward Control"
date: "2026-04-30T16:26:39.261Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "signals-and-systems-full-notes"
source_file: "Signals and Systems full notes.pdf"
locations: ["Page 105"]
related: ["open-loop-inverse-control", "feedback-control-loop-equations", "disturbance-rejection", "pid-control-structure-and-purpose"]
tags: ["feedforward-control", "disturbance", "rhp-zeros", "time-delays", "non-minimum-phase", "non-causal"]
---

## Limitations of Feedforward Control

Source: [[signals-and-systems-full-notes|Signals and Systems Full Notes: Sinusoids, Spectra, Sampling, Aliasing, and FIR Filters]]

Locations: Page 105

The notes identify feedforward control as fundamentally flawed in practice despite its appealing algebraic simplicity. First, the model $G(s)$ is never known exactly: physical systems contain unmodeled dynamics, parameter variations, aging effects, and approximations from modeling and linearization. Therefore the true plant differs from the model, and exact inverse cancellation does not occur. Second, inverse control can fail because of stability and realizability. If $G(s)$ has right-half-plane zeros, time delays, or nonminimum-phase behavior, then $G^{-1}(s)$ is typically unstable or noncausal, so it cannot be implemented meaningfully. Third, feedforward control cannot react to disturbances because the input is computed in advance and does not depend on measured output. If an additive disturbance enters, the true behavior becomes $y(t)=g(t)*u(t)+d(t)$, so even a perfectly chosen model-based input can produce an output different from the desired signal.

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

### Key points

- Exact feedforward cancellation fails when the plant model is inaccurate.
- Model errors include unmodeled dynamics, parameter variations, aging effects, and linearization approximations.
- Right-half-plane zeros, time delays, and nonminimum-phase behavior can make $G^{-1}(s)$ unstable or noncausal.
- Feedforward control computes input in advance without observing the output.
- With output disturbance, the behavior becomes $y(t)=g(t)*u(t)+d(t)$.
- Feedback control is introduced to correct deviations caused by disturbances and uncertainty.

### Related topics

- [[open-loop-inverse-control|Open-Loop Inverse Control]]
- [[feedback-control-loop-equations|Feedback Control Loop Equations]]
- [[disturbance-rejection|Disturbance Rejection]]
- [[pid-control-structure-and-purpose|PID Control Structure and Purpose]]

### Relationships

- enables: [[feedback-control-loop-equations|Feedback Control Loop Equations]]
- related: [[disturbance-rejection|Disturbance Rejection]]
