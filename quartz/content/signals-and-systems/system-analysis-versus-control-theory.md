---
title: "System Analysis Versus Control Theory"
date: "2026-04-30T16:26:39.261Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "signals-and-systems-full-notes"
source_file: "Signals and Systems full notes.pdf"
locations: ["Page 103", "Page 104"]
related: ["open-loop-inverse-control", "limitations-of-feedforward-control", "feedback-control-loop-equations"]
tags: ["control-theory", "system-analysis", "plant", "impulse-response", "transfer-function", "convolution-integral"]
---

## System Analysis Versus Control Theory

Source: [[signals-and-systems-full-notes|Signals and Systems Full Notes: Sinusoids, Spectra, Sampling, Aliasing, and FIR Filters]]

Locations: Page 103, Page 104

The notes distinguish classical systems analysis from control theory. In classical signals and systems, the system is described by an impulse response $g(t)$ or transfer function $G(s)$, and the input $u(t)$ is known. The objective is to determine the output $y(t)$. For linear time-invariant systems, this relationship is expressed by convolution in time and multiplication in the Laplace domain: $y(t)=g(t)*u(t) \Leftrightarrow Y(s)=G(s)U(s)$. Control theory reverses the perspective. The physical process, or plant, $G$, is assumed to be given and fixed, while the objective is to choose the input so the output follows a desired signal $y_d(t)$. In control, the central question becomes: given $G$ and desired output $y_d(t)$, what input $u(t)$ should be applied so that $y(t)$ follows $y_d(t)$ as closely as possible?

### Page-grounded details

#### Page 103

ex/ Simplify the system below and find the equivalent transfer function

[Block diagram description:
Input `R` enters a summing junction with `+` on the input from `R` and `-` on a lower feedback input. The output goes to a second summing junction with `+` on the left input and `+` on a lower input. This then goes through block `G1` to output `Y`. From the output line, a branch feeds back left through block `G2` into the lower `+` input of the second summing junction. The same output line also branches downward to two parallel feedback paths through blocks `G3` and `G4`, both feeding a lower summing junction marked `+` and `+`; its output feeds upward into the `-` input of the first summing junction.]

`G1 = (s+2)/(s+3)`

`G2 = 2/(s+2)`

`G3 = 3/(s+3)`

`G4 = s/(s+3)`


down solution

[Reduced block diagram description:
Input `R` enters a summing junction with `+` on the input and `-` on the lower feedback input. Forward path block is `G1/(1 - G1G2)` leading to output `Y`. Feedback path from `Y` returns through block `G3 + G4` into the negative input of the summing junction.]

->

[Equivalent single-block diagram description:
Input `R` passes through one block to output `Y`. The bl

[Truncated for analysis]

#### Page 104

In this framework, the input is assumed to be known, and the system's
behaviour is analyzed passively

Control theory inverts this perspective. The system G, representing a
physical process such as a mechanical structure, an electrical circuit, or a
thermal system, often referred to as plant, is assumed to be given and
fixed. The objective is no longer to predict the output resulting from a
prescribed input, but instead to determine how the input must be chosen
so that the output behaves in a desired way.

In other words, control asks: given a system G and a desired output
signal y_d(t), what input u(t) should be applied so that the actual
output y(t) follows y_d(t) as closely as possible.

At first, this problem appears trivial when expressed in the laplace domain.
If the desired output has Laplace transform Y_d(s), and if the system
satisfies Y(s) = G(s) U(s), then algebraic manipulation suggest that the
required input is U_d(s) = 1/G(s) * Y_d(s)

- system analysis

U(s) -> [ G(s) ] -> Y(s)
                 up plant

- initial case of control

Y_d(s) -> [ 1/G(s) ] -> U_d(s) -> [ G(s) ] -> Y(s)
                         ↘ often called "control effort"

This approach corresponds to

[Truncated for analysis]

### Key points

- Classical system analysis predicts output from a known input and known system.
- For LTI systems, $y(t)=g(t)*u(t)$ in time domain.
- For LTI systems, $Y(s)=G(s)U(s)$ in Laplace domain.
- Control theory treats the plant $G$ as given and fixed.
- Control chooses the input $u(t)$ so the actual output follows a desired output $y_d(t)$.
- The desired output is later called the reference or setpoint.

### Related topics

- [[open-loop-inverse-control|Open-Loop Inverse Control]]
- [[limitations-of-feedforward-control|Limitations of Feedforward Control]]
- [[feedback-control-loop-equations|Feedback Control Loop Equations]]

### Relationships

- related: [[open-loop-inverse-control|Open-Loop Inverse Control]]
- contrasts-with: [[feedback-control-loop-equations|Feedback Control Loop Equations]]
