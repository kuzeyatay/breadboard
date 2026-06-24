---
title: "Equivalent Representations of FIR Filters"
date: "2026-04-30T16:26:39.261Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "signals-and-systems-full-notes"
source_file: "Signals and Systems full notes.pdf"
locations: ["Page 34", "Page 35"]
related: ["fir-filter-implementation-blocks", "unit-impulse-response-of-an-fir-filter", "discrete-convolution-sum"]
tags: ["realization-scheme", "difference-equation", "impulse-response", "convolution", "fir-filter"]
---

## Equivalent Representations of FIR Filters

Source: [[signals-and-systems-full-notes|Signals and Systems Full Notes: Sinusoids, Spectra, Sampling, Aliasing, and FIR Filters]]

Locations: Page 34, Page 35

The notes emphasize that an FIR filter or discrete-time LTI system can be described in several equivalent ways. The four listed representations are the realization scheme or block diagram, the difference equation, the impulse response, and convolution. Each representation encodes the same filter coefficients. For example, the system $y[n]=x[n]-x[n-1]$ has impulse response $h[n]=\delta[n]-\delta[n-1]$ and can be drawn as a direct branch minus a one-sample delayed branch. When the input $x[n]=\delta[n]+2\delta[n-1]-\delta[n-2]$ is convolved with coefficients $\{1,-1\}$, the output sequence is computed as $y[0]=1$, $y[1]=1$, $y[2]=-3$, and $y[3]=1$. This illustrates how the same system can be understood through equations, diagrams, impulse responses, and convolution tables.

### Page-grounded details

#### Page 34

which we can represent as block diagrams:

Multiplier

[diagram: x[n] enters a multiplier circle marked "ה; β enters upward into the multiplier; output arrow labeled y[n]]

y[n] = β x[n]


Adder

[diagram: x_1[n] enters an adder circle marked "+"; x_2[n] enters upward into the adder; output arrow labeled y[n]]

y[n] = x_1[n] + x_2[n]


Unit Delay

[diagram: x[n] enters a square block labeled "T"; output arrow labeled y[n]]

y[n] = x[n-1]


ex/

[diagram: third-order FIR filter block diagram. Input x[n] travels along a top horizontal line. Four taps feed multipliers labeled b_0, b_1, b_2, b_3. Three stacked square blocks on the left are each labeled "unit delay", forming a delay line. The top direct path x[n] goes to multiplier b_0. After the first unit delay the signal goes to multiplier b_1. After the second unit delay the signal goes to multiplier b_2. After the third unit delay the signal goes to multiplier b_3. The four multiplier outputs feed a vertical chain of three adders marked "+" on the right. The final output arrow is labeled y[n].]

- Block diagram for a
third-order FIR filter

DE = b_0 x[n] + b_1 x[n-1] + b_2 x[n-2]
     + b_3 x[n-3]


- These are the 4 things that de

[Truncated for analysis]

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

### Key points

- A realization scheme is a block-diagram representation of an FIR filter.
- A difference equation expresses output using delayed input samples.
- An impulse response lists the filter coefficients as impulse weights.
- Convolution computes the output from input and impulse response.
- All four descriptions give the same filter coefficients.
- The system $y[n]=x[n]-x[n-1]$ corresponds to $h[n]=\delta[n]-\delta[n-1]$.

### Related topics

- [[fir-filter-implementation-blocks|FIR Filter Implementation Blocks]]
- [[unit-impulse-response-of-an-fir-filter|Unit Impulse Response of an FIR Filter]]
- [[discrete-convolution-sum|Discrete Convolution Sum]]

