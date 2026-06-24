---
title: "Disturbance Rejection"
date: "2026-04-30T16:26:39.261Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "signals-and-systems-full-notes"
source_file: "Signals and Systems full notes.pdf"
locations: ["Page 112"]
related: ["limitations-of-feedforward-control", "closed-loop-responses-to-reference-disturbance-and-sensor-noise", "system-type-for-reference-tracking", "pid-control-structure-and-purpose"]
tags: ["disturbance-rejection", "h-s", "twy", "steady-state-error", "system-type", "d-s-g-s"]
---

## Disturbance Rejection

Source: [[signals-and-systems-full-notes|Signals and Systems Full Notes: Sinusoids, Spectra, Sampling, Aliasing, and FIR Filters]]

Locations: Page 112

Disturbance rejection is the ability of a control system to prevent unwanted external signals from affecting the output in steady state, transient behavior, or over time. The notes treat disturbance rejection analogously to reference tracking: set the reference to zero and analyze the response to polynomial disturbance inputs such as step, ramp, and parabolic disturbances. In the diagram on page 112, a disturbance $w$ passes through $H(s)$ and enters additively at the output summing junction, while the feedback loop contains controller $D(s)$ and plant $G(s)$. The transfer from disturbance to output is given as $T_{wy}=H(s)/(1+D(s)G(s))$. The system type for disturbance rejection is characterized by the small-$s$ behavior of $H(s)/(1+D(s)G(s))$ multiplied by polynomial disturbance factors. The notes state a condition involving $\lim_{s\to0}sE(s)=-\frac{H(s)}{1+D(s)G(s)}\frac{1}{s^k}=K\ne0$.

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

### Key points

- Disturbance rejection measures the system ability to prevent unwanted external signals from affecting output.
- For disturbance analysis, the reference is set to zero.
- Polynomial disturbance inputs include step, ramp, and parabolic inputs.
- The disturbance path uses $w -> H(s)$ into an output summing junction.
- The disturbance-to-output transfer is $T_{wy}=H(s)/(1+D(s)G(s))$.
- Disturbance rejection system type is determined similarly to reference tracking by low-frequency loop behavior.

### Related topics

- [[limitations-of-feedforward-control|Limitations of Feedforward Control]]
- [[closed-loop-responses-to-reference-disturbance-and-sensor-noise|Closed-Loop Responses to Reference Disturbance and Sensor Noise]]
- [[system-type-for-reference-tracking|System Type for Reference Tracking]]
- [[pid-control-structure-and-purpose|PID Control Structure and Purpose]]

### Relationships

- related: [[pid-control-structure-and-purpose|PID Control Structure and Purpose]]
