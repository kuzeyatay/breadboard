---
title: "Closed-Loop Responses to Reference Disturbance and Sensor Noise"
date: "2026-04-30T16:26:39.261Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "signals-and-systems-full-notes"
source_file: "Signals and Systems full notes.pdf"
locations: ["Page 107"]
related: ["feedback-control-loop-equations", "closed-loop-characteristic-equation-and-controller-design", "disturbance-rejection", "reference-tracking-and-steady-state-error"]
tags: ["closed-loop-transfer-function", "disturbance", "sensor-measurement-noise", "compensator", "plant", "tcl"]
---

## Closed-Loop Responses to Reference Disturbance and Sensor Noise

Source: [[signals-and-systems-full-notes|Signals and Systems Full Notes: Sinusoids, Spectra, Sampling, Aliasing, and FIR Filters]]

Locations: Page 107

Page 107 defines a classical closed-loop system with controller $D(s)$, plant $G(s)$, reference $R(s)$, plant-input disturbance $W(s)$, and sensor measurement noise $V(s)$. The measured feedback signal is $Y+V$, so the error is $E=R-(Y+V)=R-Y-V$. The controller output is $U=DE=D(R-Y-V)$, and the plant output is modeled as $Y=G(U+W)$. Solving the loop gives the output as a superposition of reference, disturbance, and measurement-noise effects: $Y(s)=\frac{DG}{1+DG}R+\frac{G}{1+DG}W-\frac{DG}{1+DG}V$. The control signal and error are also decomposed into terms driven by $R$, $W$, and $V$. This form shows why the closed-loop transfer function $T_{cl}=GD/(1+GD)$ is only one part of the complete performance description; disturbance and noise paths matter too.

### Page-grounded details

#### Page 107

In a bit, we will look at how to design more (and appropriate) controllers
intro better but first, we need the metrics to design said controllers.
First, we define a classical closed loop system, depicted as;

[Diagram: left input arrow labelled R(s) enters a summing junction. The top input is positive and the bottom feedback input is negative. Output from the junction is labelled E(s), then enters a block labelled D(s) with "controller" written above it. The output is labelled U(s), then enters a second summing junction. A top downward input labelled W(s) enters this junction with a plus sign. The output then goes into a block labelled G(s), with "plant" written above it. The output arrow is labelled Y(s). From Y(s), a feedback branch goes downward into another summing junction at the lower right. A downward input labelled V(s) enters this lower summing junction; both inputs are marked plus. The output of this lower summing junction runs left along the bottom and up into the negative input of the first summing junction. Notes near diagram: "also called a compensator" by D(s), "disturbance" near W(s), and "sensor measurement noise" near V(s).]

E = R - (Y + V) = R - Y - V,     U =

[Truncated for analysis]

### Key points

- The measured feedback includes sensor noise: $Y+V$.
- The error is $E=R-Y-V$.
- The controller output is $U=D(R-Y-V)$.
- The plant relation is $Y=G(U+W)$.
- The output response is $Y=\frac{DG}{1+DG}R+\frac{G}{1+DG}W-\frac{DG}{1+DG}V$.
- The closed-loop transfer function is denoted $T_{cl}=GD/(1+GD)$.

### Related topics

- [[feedback-control-loop-equations|Feedback Control Loop Equations]]
- [[closed-loop-characteristic-equation-and-controller-design|Closed-Loop Characteristic Equation and Controller Design]]
- [[disturbance-rejection|Disturbance Rejection]]
- [[reference-tracking-and-steady-state-error|Reference Tracking and Steady-State Error]]

### Relationships

- applies-to: [[disturbance-rejection|Disturbance Rejection]]
- related: [[closed-loop-characteristic-equation-and-controller-design|Closed-Loop Characteristic Equation and Controller Design]]
