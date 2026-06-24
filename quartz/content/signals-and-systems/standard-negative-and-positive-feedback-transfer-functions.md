---
title: "Standard Negative and Positive Feedback Transfer Functions"
date: "2026-04-30T16:26:39.261Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "signals-and-systems-full-notes"
source_file: "Signals and Systems full notes.pdf"
locations: ["Page 98"]
related: ["parallel-subtraction-in-block-diagrams", "open-loop-inverse-control", "feedback-control-loop-equations", "closed-loop-characteristic-equation-and-controller-design", "worked-reduction-with-inner-feedback-and-parallel-feedforward", "worked-reduction-with-h1-h2-h3-feedback-paths"]
tags: ["feedback-connection", "negative-feedback", "positive-feedback", "unity-feedback", "closed-loop-transfer-function"]
---

## Standard Negative and Positive Feedback Transfer Functions

Source: [[signals-and-systems-full-notes|Signals and Systems Full Notes: Sinusoids, Spectra, Sampling, Aliasing, and FIR Filters]]

Locations: Page 98

Feedback is presented as the most important block diagram interconnection because it changes system behavior, robustness, and sensitivity to disturbances. In a standard single-loop negative feedback system, $G_1(s)$ is the forward-path transfer function and $G_2(s)$ is the feedback transfer function. The summing junction forms $U_1(s)=R(s)-Y_1(s)G_2(s)$, and the plant output is $Y_1(s)=U_1(s)G_1(s)$. Substituting and solving gives $Y_1(s)[1+G_1(s)G_2(s)]=G_1(s)R(s)$, so the closed-loop transfer from reference to output is $Y_1(s)/R(s)=G_1(s)/(1+G_1(s)G_2(s))$. For unity negative feedback, where $G_2(s)=1$, this becomes $Y(s)=R(s)G(s)/(1+G(s))$. For unity positive feedback, the denominator changes sign, giving $Y(s)=R(s)G(s)/(1-G(s))$. These formulas are the basis for later controller, tracking, and disturbance-rejection derivations.

### Page-grounded details

#### Page 98

If these outputs are substracted at a summing junction

[Diagram: input U(s) splits into two parallel branches. Upper branch block labeled G_1(s), lower branch block labeled G_2(s). Both feed a summing junction at right; upper input marked + and lower input marked -. Output arrow labeled Y(s).]

Y(s) = [G_1(s) - G_2(s)] U(s)

G overall(s) = G_1(s) - G_2(s)

3) Feedback Connection:

* Feedback is the most important block diagram interconnection because
it fundamentally alters system behaviour, robustness, and sensitivity
to disturbances

* Consider a standard single-loop negative feedback system. Let G_1(s)
denote the forward path transfer function and G_2(s) denote the feedback
transfer function. The reference input is R(s), the output is Y(s)

[Diagram: negative feedback loop. R(s) enters summing junction from left; + sign at reference input and - sign at feedback input. Output of summing junction labeled U(s) goes right through block G_1(s). Output arrow labeled Y_1(s). Output branches downward and around through feedback block G_2(s), with arrow returning left/up into the negative input of the summing junction.]

U_1(s) = R(s) - Y_1(s)G_2(s)

Y_1(s) = U_1(s).G_1(s)

Y_1(s) = [R(

[Truncated for analysis]

### Key points

- Negative feedback subtracts the measured feedback signal from the reference.
- The standard negative feedback error relation is $U_1(s)=R(s)-Y_1(s)G_2(s)$.
- The closed-loop negative feedback transfer function is $G_1(s)/(1+G_1(s)G_2(s))$.
- Unity negative feedback gives $Y(s)=R(s)G(s)/(1+G(s))$.
- Unity positive feedback gives $Y(s)=R(s)G(s)/(1-G(s))$.
- Feedback alters robustness, disturbance sensitivity, and overall system behavior.

### Related topics

- [[parallel-subtraction-in-block-diagrams|Parallel Subtraction in Block Diagrams]]
- [[open-loop-inverse-control|Open-Loop Inverse Control]]
- [[feedback-control-loop-equations|Feedback Control Loop Equations]]
- [[closed-loop-characteristic-equation-and-controller-design|Closed-Loop Characteristic Equation and Controller Design]]
- [[worked-reduction-with-inner-feedback-and-parallel-feedforward|Worked Reduction with Inner Feedback and Parallel Feedforward]]
- [[worked-reduction-with-h1-h2-h3-feedback-paths|Worked Reduction with H1 H2 H3 Feedback Paths]]

### Relationships

- depends-on: [[feedback-control-loop-equations|Feedback Control Loop Equations]]
- applies-to: [[worked-reduction-with-inner-feedback-and-parallel-feedforward|Worked Reduction with Inner Feedback and Parallel Feedforward]]
- applies-to: [[worked-reduction-with-h1-h2-h3-feedback-paths|Worked Reduction with H1 H2 H3 Feedback Paths]]
