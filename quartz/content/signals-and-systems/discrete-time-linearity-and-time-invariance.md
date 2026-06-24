---
title: "Discrete-Time Linearity and Time Invariance"
date: "2026-04-30T16:26:39.261Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "signals-and-systems-full-notes"
source_file: "Signals and Systems full notes.pdf"
locations: ["Page 35", "Page 36"]
related: ["properties-of-convolution", "discrete-convolution-sum", "continuous-time-lti-system-properties"]
tags: ["lti-systems", "linearity", "superposition", "time-invariance", "discrete-time-system"]
---

## Discrete-Time Linearity and Time Invariance

Source: [[signals-and-systems-full-notes|Signals and Systems Full Notes: Sinusoids, Spectra, Sampling, Aliasing, and FIR Filters]]

Locations: Page 35, Page 36

A discrete-time LTI system is defined by two properties: linearity and time invariance. Linearity means superposition holds: if $x_1[n]$ produces $y_1[n]$ and $x_2[n]$ produces $y_2[n]$, then $\alpha x_1[n]+\beta x_2[n]$ produces $\alpha y_1[n]+\beta y_2[n]$. Time invariance means that delaying the input by $n_0$ delays the output by the same amount. The notes test time invariance by comparing the output of a delayed input with the delayed version of the original output. The system $y[n]=nx[n]$ is not time invariant because a delayed input gives $nx[n-n_0]$, whereas delaying the original output gives $(n-n_0)x[n-n_0]$. The system $y[n]=(x[n])^2$ is not linear because $(\alpha x_1[n]+\beta x_2[n])^2$ is not equal to $\alpha(x_1[n])^2+\beta(x_2[n])^2$. These tests establish when convolution-based LTI theory applies.

### Page-grounded details

#### Page 35

rev.

[diagram: block diagram of a discrete-time system. Input labeled x[n] enters a top branch. A vertical branch from x[n] goes down through a multiplier labeled "1" and into a lower summing node. The top branch continues through a delay block labeled T, then down the right branch through a multiplier labeled "-1" into the same summing node. Output arrow to the right is labeled y[n].]

y[n] = x[n] - x[n-1]
h[n] = δ[n] - δ[n-1]

if x[n] is defined as δ[n] + 2δ[n-1] - δ[n-2], what is the sequence y[n]?

Solution: x[n] is the sequence {x[n]} = {1, 2, -1} and filter coefficients
are {b_k} = {1, -1}. using convolution with synthetic multiplication.

\[
\sum_{k=0}^{1} h[n-k] \cdot x[k]
\]

[small table/diagram labeled "x[n] sequence" at left with entries 1, 2, -1 vertically; "filter coef" across top with entries 1, -1. Diagonal multiplication/convolution grid drawn with circled multiplication and plus symbols.]

∴ y[0] = 1
y[1] = 1
y[2] = -3
y[3] = 1


4.6 Linear Time-Invariant LTI Systems

- A Discrete LTI system is a system that satisfies two properties:
linearity (superposition) and time invariance. These two properties together
imply a very powerful representation of any system in

[Truncated for analysis]

#### Page 36

w/ define the system  y[n] = n x[n]

1) x_1[n] = x[n-n_0]  ,  y_1[n] = n x[n-n_0]

2) y[n] = ?  S[n-n_0]  ;  y[n-n_0] = (n-n_0) x[n-n_0]

∴ Therefore this is not an LTI system because its not time invariant


-> Linearity (superposition)  Linear systems have the property that if
x_1[n] -> y_1[n]  and  x_2[n] -> y_2[n]  then  x[n] = αx_1[n] + βx_2[n] -> αy_1[n] + βy_2[n]
with x[n] = x_1[n] + x_2[n] so  y[n] = y_1[n] + y_2[n]


Diagram:
x_1[n]  ->  [system]  -> y_1[n] -> (multiplier labeled α) \
                                                            -> (+) -> w[n]
x_2[n]  ->  [system]  -> y_2[n] -> (multiplier labeled β) /

} if w[n] = y[n] then the system is linear


Diagram:
x_1[n] -> (multiplier labeled α) \
                              -> (+) -> x[n] -> [system] -> y[n]
x_2[n] -> (multiplier labeled β) /


ex/ Define the system  y[n] = (x[n])^2

Let: For x_1 in x_2:  y[n] = (αx_1[n] + βx_2[n])^2 != α(x_1[n])^2 + β(x_2[n])^2

∴ This is not an LTI system because it isnt linear


ex/ Consider  y[n] = x[n] - x[n-1], and x[n] = δ[n] + 2δ[n-1] - δ[n-2]

We can also write  x[n] = x_1[n] + 2x_2[n] - x_3[n]  with  x_1[n] = δ[n], x_2[n] = δ[n-1]
and x_3[n] = δ[n-2]

Now we can write:

[Truncated for analysis]

### Key points

- Discrete LTI systems satisfy both linearity and time invariance.
- Time invariance requires that a delayed input produce the same delayed output.
- The test condition is $w[n]=y[n-n_0]$.
- $y[n]=nx[n]$ fails time invariance.
- Linearity requires superposition for scaled sums of inputs.
- $y[n]=(x[n])^2$ fails linearity.

### Related topics

- [[properties-of-convolution|Properties of Convolution]]
- [[discrete-convolution-sum|Discrete Convolution Sum]]
- [[continuous-time-lti-system-properties|Continuous-Time LTI System Properties]]

### Relationships

- depends-on: [[discrete-convolution-sum|Discrete Convolution Sum]]
