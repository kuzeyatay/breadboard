---
title: "Steady-State Error Examples for Step Ramp and Parabolic Inputs"
date: "2026-04-30T16:26:39.261Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "signals-and-systems-full-notes"
source_file: "Signals and Systems full notes.pdf"
locations: ["Page 111"]
related: ["reference-tracking-and-steady-state-error", "system-type-for-reference-tracking", "routh-hurwitz-cubic-stability-condition"]
tags: ["steady-state-error", "step-input", "ramp-input", "parabolic-input"]
---

## Steady-State Error Examples for Step Ramp and Parabolic Inputs

Source: [[signals-and-systems-full-notes|Signals and Systems Full Notes: Sinusoids, Spectra, Sampling, Aliasing, and FIR Filters]]

Locations: Page 111

Page 111 gives three worked steady-state error examples that illustrate system type. For a step input, $r(t)=1(t)$ and $R(s)=1/s$. With $DG(s)=10/[s(s+2)]$, the notes compute $K_p=\lim_{s\to0}DG(s)=5$ and $E_{ss}=1/(1+K_p)=1/6$, identifying the system as type 0 with respect to reference tracking. For a ramp input, $r(t)=t$ and $R(s)=1/s^2$. With $DG(s)=10/[s(s+3)]$, the notes compute $K_v=\lim_{s\to0}sDG(s)=10/3$ and $E_{ss}=1/K_v=3/10$, identifying type 1. For a parabolic input, $r(t)=t^2/2$ and $R(s)=1/s^3$. With $DG(s)=5(s+2)/[s^2(s+3)]$, the notes compute $K_a=\lim_{s\to0}s^2DG(s)=10/3$ and $E_{ss}=1/K_a=3/10$, identifying type 2.

### Page-grounded details

#### Page 111

√ steady state errors

step input

[graph: response vs t. Vertical axis labeled y, horizontal axis labeled t. Curve rises from 0, overshoots, dips, then settles to a nonzero steady value.]

- r(t)=1(t) -> R(s)=1/s

- DG(s)= 10 / s(s+2)

- kp = lim s->0 DG(s) = 5

- Ess = 1/(1+kp) = 1/6

- system type 0 with respect to reference tracking.

Ramp input

[graph: response vs t. Vertical axis labeled y, horizontal axis labeled t. Curve increases upward with accelerating/curved behavior.]

- r(t)=t -> R(s)=1/s^2

- DG(s)= 10 / s(s+3)

- Kv = lim s->0 sDG = 10/3

- Ess = 1/Kv = 3/10

- System type 1 with respect to reference tracking.

Parabolic input

[graph: response vs t. Vertical axis labeled y, horizontal axis labeled t. Curve rises with parabolic curvature.]

- r(t)=1/2 t^2 -> R(s)=1/s^3

- DG(s)= 5(s+2) / s^2(s+3)

- Ka = lim s->0 s^2DG = 10/3

- Ess = 1/Ka = 3/10

- System type 2 with respect to reference tracking

Ex/ for the feedback loop in figure below consider system transfer
function G(s)= 2/(s+2) and the feedback controller D(s)=kp + skd
what is the closed loop system type with respect to reference tracking

[block diagram:
R enters summing junction with + on input from R an

[Truncated for analysis]

### Key points

- Step example uses $r(t)=1(t)$ and $R(s)=1/s$.
- For the step example, $DG(s)=10/[s(s+2)]$, $K_p=5$, and $E_{ss}=1/6$.
- Ramp example uses $r(t)=t$ and $R(s)=1/s^2$.
- For the ramp example, $DG(s)=10/[s(s+3)]$, $K_v=10/3$, and $E_{ss}=3/10$.
- Parabolic example uses $r(t)=t^2/2$ and $R(s)=1/s^3$.
- For the parabolic example, $DG(s)=5(s+2)/[s^2(s+3)]$, $K_a=10/3$, and $E_{ss}=3/10$.
- The examples correspond to type 0, type 1, and type 2 reference tracking cases.

### Related topics

- [[reference-tracking-and-steady-state-error|Reference Tracking and Steady-State Error]]
- [[system-type-for-reference-tracking|System Type for Reference Tracking]]
- [[routh-hurwitz-cubic-stability-condition|Routh Hurwitz Cubic Stability Condition]]

