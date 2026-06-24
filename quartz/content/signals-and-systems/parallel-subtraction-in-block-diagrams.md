---
title: "Parallel Subtraction in Block Diagrams"
date: "2026-04-30T16:26:39.261Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "signals-and-systems-full-notes"
source_file: "Signals and Systems full notes.pdf"
locations: ["Page 98", "Page 101"]
related: ["block-diagram-reduction-rules", "standard-negative-and-positive-feedback-transfer-functions", "worked-reduction-with-inner-feedback-and-parallel-feedforward", "worked-reduction-with-h1-h2-h3-feedback-paths"]
tags: ["parallel", "summing-junction", "transfer-function", "g-1-s", "g-2-s"]
---

## Parallel Subtraction in Block Diagrams

Source: [[signals-and-systems-full-notes|Signals and Systems Full Notes: Sinusoids, Spectra, Sampling, Aliasing, and FIR Filters]]

Locations: Page 98, Page 101

When an input signal is split into two parallel transfer-function branches and the branch outputs are subtracted at a summing junction, the equivalent transfer function is the algebraic difference of the branch transfer functions. In the page 98 diagram, the input $U(s)$ feeds two parallel blocks, $G_1(s)$ and $G_2(s)$. Their outputs enter a summing junction with the upper input marked positive and the lower input marked negative. Because both branches are driven by the same input, the output is the positive branch response minus the negative branch response. This gives $Y(s) = [G_1(s) - G_2(s)]U(s)$, so the overall transfer function from $U(s)$ to $Y(s)$ is $G_{overall}(s)=G_1(s)-G_2(s)$. This is one of the fundamental block diagram reduction rules used repeatedly in later examples, including reductions where feedforward branches combine as $G_3-G_4$ or $G_3+G_4$ depending on summing signs.

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

#### Page 101

[Top block diagram]

R -> (+) summing junction -> block: G1G2 / (1 + G1G2H1) -> (- at next summing junction, + from left) -> block: (G3 - G4) -> block: G5 -> Y

Feedback from output Y loops upward through block H3 and enters the second summing junction with negative sign.

Feedback from output Y loops downward through block H2 / G1 and enters the first summing junction with positive sign.

->

[Second equivalent block diagram]

R -> (+) summing junction, feedback negative from below -> block: G1G2 / (1 + G1G2H1) -> block: ((G3 - G4)G5) / (1 + (G3 - G4)G5H3) -> X

Feedback from X loops downward through block H2 / G5 and returns to the summing junction with negative sign.

[Final equivalent transfer function block]

R -> large block -> Y

Large block contains:

\[
\frac{
\left(\frac{G_1G_2}{1+G_1G_2H_1}\right)
\left(\frac{(G_3-G_4)G_5}{1+(G_3-G_4)G_5H_3}\right)
}{
1-
\left(\frac{G_1G_2}{1+G_1G_2H_1}\right)
\left(\frac{(G_3-G_4)G_5}{1+(G_3-G_4)G_5H_3}\right)
\frac{H_2}{G_5}
}
\]

Now simplify the system below and find the equivalent transfer function

[Bottom block diagram]

R -> first summing junction:
- R enters with + sign.
- Feedback from lower path enters with - sign.

First summ

[Truncated for analysis]

### Key points

- Parallel branch outputs combine according to the signs at the summing junction.
- If the upper branch is positive and the lower branch is negative, the equivalent transfer function is a difference.
- For common input $U(s)$, the output is $Y(s)=[G_1(s)-G_2(s)]U(s)$.
- The overall transfer function is $G_{overall}(s)=G_1(s)-G_2(s)$.
- The same algebraic rule applies to more complex feedforward combinations during block reduction.

### Related topics

- [[block-diagram-reduction-rules|Block Diagram Reduction Rules]]
- [[standard-negative-and-positive-feedback-transfer-functions|Standard Negative and Positive Feedback Transfer Functions]]
- [[worked-reduction-with-inner-feedback-and-parallel-feedforward|Worked Reduction with Inner Feedback and Parallel Feedforward]]
- [[worked-reduction-with-h1-h2-h3-feedback-paths|Worked Reduction with H1 H2 H3 Feedback Paths]]

### Relationships

- part-of: [[block-diagram-reduction-rules|Block Diagram Reduction Rules]]
- applies-to: [[worked-reduction-with-h1-h2-h3-feedback-paths|Worked Reduction with H1 H2 H3 Feedback Paths]]
