---
title: "Cascaded Discrete-Time LTI Systems"
date: "2026-04-30T16:26:39.261Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "signals-and-systems-full-notes"
source_file: "Signals and Systems full notes.pdf"
locations: ["Page 41", "Page 42"]
related: ["properties-of-convolution", "discrete-convolution-sum", "discrete-unit-step-signal"]
tags: ["cascaded-lti-systems", "convolution", "commutative-property", "equivalent-lti"]
---

## Cascaded Discrete-Time LTI Systems

Source: [[signals-and-systems-full-notes|Signals and Systems Full Notes: Sinusoids, Spectra, Sampling, Aliasing, and FIR Filters]]

Locations: Page 41, Page 42

A cascade connection feeds the output of one system into the input of another. The notes state that LTI systems in cascade can be implemented in either order because convolution is commutative. If two systems have impulse responses $h_1[n]$ and $h_2[n]$, then the equivalent system has impulse response $h[n]=h_1[n]*h_2[n]$. The diagrams show three equivalent systems: $h_1$ followed by $h_2$, $h_2$ followed by $h_1$, and one equivalent LTI block with impulse response $h_1*h_2$. In one example, $h_1[n]=\delta[n]+\delta[n-1]$, $h_2[n]=\delta[n]-\delta[n-1]$, and $x[n]=u[n]$. Their cascade has equivalent response $\delta[n]-\delta[n-2]$, giving output $u[n]-u[n-2]$, a length-2 pulse starting at $n=0$. Another example computes $w[n]=u[n]*h_1[n]$ and a longer equivalent impulse response for cascaded systems.

### Page-grounded details

#### Page 41

4.7 Cascaded LTI Systems

- In a cascade connection of two systems, the output of the first
system is the input to the second system, and the overall output of the
cascade system is taken to be the output of the second system.

- LTI systems have the remarkable property that two LTI
systems in cascade can be implemented in either order. This property
is a direct consequence of the commutative property applied to the impulse
response of LTI systems.

[Diagram: First cascade block diagram]
x[n] / δ[n] -> [LTI 1
h_1[n]] -> w[n]
h_1[n] -> [LTI 2
h_2[n]] -> y[n]
h_1[n] * h_2[n]

[Diagram: Second cascade block diagram]
x[n] / δ[n] -> [LTI 2
h_2[n]] -> w[n]
h_2[n] -> [LTI 1
h_1[n]] -> y[n]
h_2[n] * h_1[n]

[Diagram: Equivalent LTI block diagram]
x[n] / δ[n] -> [Equivalent LTI
h[n] = h_1[n] * h_2[n]] -> y[n]
h_1[n] * h_2[n]

[Right brace grouping all three diagrams] -> Three equivalent
Cascaded LTI
Systems.

Ex/ let h_1[n] = δ[n] + δ[n-1], h_2[n] = δ[n] - δ[n-1], x[n] = u[n]
determine the sequence y[n]

Solution: y[n] = u[n] * (h_1[n] * h_2[n])

y[n] = u[n] * (δ[n] - δ[n-2])

= u[n] - u[n-2]      which is a length 2 pulse at n = 0.

[Small plotted stem/sequence graph labeled h[n]]
h[n]
axi

[Truncated for analysis]

#### Page 42

[Top diagram: discrete-time system block diagram. Left input arrow labeled x(n)=u(n), through a rectangular block labeled h_1(n), output labeled w(n). Then into a dashed box labeled h_2(n): top branch goes directly to a summing junction "+"; lower branch taps down, passes through two delay blocks, then into a multiplier/circle marked "ה with a coefficient label near it, then up into the summing junction. Output arrow labeled y(n).]

a) Let h_1(n) = 2 δ[n] + δ[n-1] - δ[n-2] , what is w(n)

b) What is the equivalent system h(n)

down

w(n) = u(n) * h_1(n)

= 2u[n] + u[n-1] - u[n-2]

or

[Table/grid for convolution. Top row labeled h_1(n): 2   1   -1. Left column labeled x(n): 1, 1, 1, 1, ... . Diagonal entries shown producing repeated sums. Right-side/inside entries include 2, 1, -1 across rows.]

w(n) = 2 δ[n] + 3 δ[n-1] + 2u[n-2]

b) h(n) = h_1(n) * h_2(n) where h_2(n) = δ[n] + 2δ[n-2]

[Convolution table/grid. Top row h_1(n): 2   1   0   2. Left column h_2(n): 2, 1, -1. Diagonal slash marks show convolution products/sums. Visible entries include 4, 2, 0, -2.]

-> h(n) = 2δ[n] + δ[n-1] + 3δ[n-2] + 2δ[n-3]
        -2δ[n-4]

### Key points

- In a cascade, the output of the first system becomes the input of the second.
- For LTI systems, cascade order can be swapped.
- The equivalent impulse response is $h[n]=h_1[n]*h_2[n]$.
- Commutativity of convolution explains cascade-order equivalence.
- $h_1[n]=\delta[n]+\delta[n-1]$ cascaded with $h_2[n]=\delta[n]-\delta[n-1]$ gives $\delta[n]-\delta[n-2]$.
- For input $u[n]$, the output becomes $u[n]-u[n-2]$.

### Related topics

- [[properties-of-convolution|Properties of Convolution]]
- [[discrete-convolution-sum|Discrete Convolution Sum]]
- [[discrete-unit-step-signal|Discrete Unit Step Signal]]

### Relationships

- depends-on: [[discrete-convolution-sum|Discrete Convolution Sum]]
- depends-on: [[properties-of-convolution|Properties of Convolution]]
