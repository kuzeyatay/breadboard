---
title: "Closed-Loop Characteristic Equation and Controller Design"
date: "2026-04-30T16:26:39.261Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "signals-and-systems-full-notes"
source_file: "Signals and Systems full notes.pdf"
locations: ["Page 107"]
related: ["feedback-control-loop-equations", "closed-loop-responses-to-reference-disturbance-and-sensor-noise", "routh-hurwitz-cubic-stability-condition", "pid-control-structure-and-purpose"]
tags: ["characteristic-equation", "controller-design", "closed-loop-poles", "stability", "a-s", "b-s"]
---

## Closed-Loop Characteristic Equation and Controller Design

Source: [[signals-and-systems-full-notes|Signals and Systems Full Notes: Sinusoids, Spectra, Sampling, Aliasing, and FIR Filters]]

Locations: Page 107

The notes connect controller design to the poles of the closed-loop system through the characteristic equation. Any physically realizable transfer function can be written as a ratio of polynomials. The plant is written $G(s)=b(s)/a(s)$, and the controller is written $D(s)=\ell(s)/d(s)$. The feedback characteristic equation begins with $1+D(s)G(s)=0$. Substituting the polynomial ratios gives $1+b(s)\ell(s)/(d(s)a(s))=0$, which is equivalent to $a(s)d(s)+b(s)\ell(s)=0$. Since the plant polynomials $a(s)$ and $b(s)$ are known, controller design changes $\ell(s)$ and $d(s)$ to shape the roots of this characteristic equation. The notes interpret this as the way controller design solves the stability problem, because closed-loop pole locations determine stability and transient behavior.

### Page-grounded details

#### Page 107

In a bit, we will look at how to design more (and appropriate) controllers
intro better but first, we need the metrics to design said controllers.
First, we define a classical closed loop system, depicted as;

[Diagram: left input arrow labelled R(s) enters a summing junction. The top input is positive and the bottom feedback input is negative. Output from the junction is labelled E(s), then enters a block labelled D(s) with "controller" written above it. The output is labelled U(s), then enters a second summing junction. A top downward input labelled W(s) enters this junction with a plus sign. The output then goes into a block labelled G(s), with "plant" written above it. The output arrow is labelled Y(s). From Y(s), a feedback branch goes downward into another summing junction at the lower right. A downward input labelled V(s) enters this lower summing junction; both inputs are marked plus. The output of this lower summing junction runs left along the bottom and up into the negative input of the first summing junction. Notes near diagram: "also called a compensator" by D(s), "disturbance" near W(s), and "sensor measurement noise" near V(s).]

E = R - (Y + V) = R - Y - V,     U =

[Truncated for analysis]

### Key points

- A realizable plant can be written $G(s)=b(s)/a(s)$.
- A realizable controller can be written $D(s)=\ell(s)/d(s)$.
- The closed-loop characteristic equation starts from $1+D(s)G(s)=0$.
- Substitution gives $a(s)d(s)+b(s)\ell(s)=0$.
- The plant polynomials are known, while controller polynomials are design variables.
- Changing controller polynomials changes closed-loop roots and therefore stability.

### Related topics

- [[feedback-control-loop-equations|Feedback Control Loop Equations]]
- [[closed-loop-responses-to-reference-disturbance-and-sensor-noise|Closed-Loop Responses to Reference Disturbance and Sensor Noise]]
- [[routh-hurwitz-cubic-stability-condition|Routh Hurwitz Cubic Stability Condition]]
- [[pid-control-structure-and-purpose|PID Control Structure and Purpose]]

### Relationships

- related: [[routh-hurwitz-cubic-stability-condition|Routh Hurwitz Cubic Stability Condition]]
- enables: [[pid-control-structure-and-purpose|PID Control Structure and Purpose]]
