---
title: "Discrete Convolution Sum"
date: "2026-04-30T16:26:39.261Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "signals-and-systems-full-notes"
source_file: "Signals and Systems full notes.pdf"
locations: ["Page 32", "Page 33", "Page 35", "Page 38"]
related: ["discrete-unit-impulse-sequence", "unit-impulse-response-of-an-fir-filter", "properties-of-convolution", "cascaded-discrete-time-lti-systems", "equivalent-representations-of-fir-filters"]
tags: ["convolution-sum", "discrete-convolution", "fir-filter", "lti-systems"]
---

## Discrete Convolution Sum

Source: [[signals-and-systems-full-notes|Signals and Systems Full Notes: Sinusoids, Spectra, Sampling, Aliasing, and FIR Filters]]

Locations: Page 32, Page 33, Page 35, Page 38

The discrete convolution sum expresses the output of an FIR or LTI system in terms of the input sequence and impulse response. For an FIR filter, because the coefficients equal the impulse response samples, the output can be written as $y[n]=\sum_{k=0}^{M}h[k]x[n-k]$. The notes also show the equivalent form $y[n]=\sum_{k=0}^{M}h[n-k]x[k]$, emphasizing the reversing and sliding interpretation of convolution. For general LTI systems, the finite convolution sum extends to an infinite sum: $y[n]=\sum_{k=-\infty}^{\infty}x[k]h[n-k]$. Convolution is also written compactly as $y[n]=x[n]*h[n]$. The output length for finite convolution is stated as signal length plus filter order, and examples use tabular or synthetic multiplication to compute individual output samples.

### Page-grounded details

#### Page 32

=> FIR Filters and Convolution:

A general expression for the FIR filters output can be derived in
terms of the impulse response. Since the filter coefficients are
identical to the impulse response values, we can replace bₖ by
h[k] to obtain

(4)     y[n] = sumᵐₖ₌_0 h[k] x[n-k]   ⇔   y[n] = sumᵐₖ₌_0 h[n-k] x[k]

[boxed region around the two equations]
[arrow/label under first equation: reversing samples]
[arrow/label under second equation: reversing filter co]
[arrow/label under boxed region: reversing samples]

where M is the filter order. Now the relation between the input and
output of the FIR filter in terms of the input and impulse response

The sum in (4) is called a finite convolution sum, which is a special case
for the Discrete convolution with finite length, which is general for LTI systems

y[n] = sum∞ₖ₌_0 x[k] h[n-k]

The length of the output (convolution) is equal signal length + filter order

=> The unit step signal:

In previous sections, we have described the FIR filtering as
finite length signals, but there is no reason that the input signal
cannot be infinite duration. An example is the discrete unit
step signal which is zero for n<0, and turns on at n=0

u[n] = {

[Truncated for analysis]

#### Page 33

Convolution can also be expressed as an operator:

┌──────────────────────────────────────────────┐
│ y[n] = sum(k=0 to M) x[k]h[n-k] = x[n] * h[n] │
└──────────────────────────────────────────────┘

Properties of Convolution:

i. Do nothing: x[n] * δ[n] = x[n]

ii. Commutative property: x_1[n] * x_2[n] = x_2[n] * x_1[n]

iii. Convolution with a shifted impulse:
    x[n] δ[n-n_0] = x[n-n_0]
    delayed

iv. Associativity: (x_1[n] * x_2[n]) * x_3[n] = x_1[n] * (x_2[n] * x_3[n])

v. Distributive property: (x_1[n] + x_2[n]) * h[n] = h[n] * x_1[n] + h[n] * x_2[n]

=> Convolution is also a linear operator, meaning, its essentially a matrix multipli[unclear]

Proof: let T: x[n] -> y[n]

T{ax_1 + bx_2} = sumk h[k]{a x_1[n-k] + b x_2[n-k]}

              = a sumk h[k]x_1[n-k] + b sumk h[k]x_2[n-k]

              = a.T{x_1} + b.T{x_2}

4.5 Implementation of FIR Filters.

Recall that the general definition of an FIR filter is:

y[n] = sum(k=0 to M) bₖ x[n-k].

In order to use the formula above to compute the output of the FIR
filter, we need the following.

1) A means for multiplying delayed input signal values by the filter co[unclear]
2) A means for adding the scaled sequence values.
3) A

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

#### Page 38

we can now clearly see that all LTI systems are defined by
the discrete convolution sum.

y[n] = x[n] * h[n] = sum from k=-∞ to ∞ x[k] * h[n-k]

where y[n] is the output sequence, x[n] is the input sequence and h[n] is
the unit impulse response. Sequence where δ[n-k] is the basis for these sequences


ex/
Let x[n] = 2δ[n] + 4δ[n-1] + 6δ[n-2] - δ[n-4]

[diagram: x[n] enters a branching discrete-time system. The top path has two delay blocks labeled T and T in series. A middle tap from between the two T blocks goes down through a multiplier marked x with a minus sign. The original input also branches along a lower path to a summing junction marked +. The outputs combine at a final summing junction marked +, producing y[n].]

h[n] = δ[n] - δ[n-1] + δ[n-2]

DE: y[n] = x[n] - x[n-1] + x[n-2]

Find the sequence y[n].


Solution: Since we know the input and filter sequences, we use the
tabular method

[table]
h[n]        1      -1      +1
x[n]
2           2      -2      2
4           4      -4      4
6           6      -6      6
0           0       0      0
-1         -1       1     -1

y[0] = 2
y[1] = 2
y[2] = 4
y[3] = -2
y[4] = 5
y[5] = 1
y[6] = -1

∴ y[n] = 2δ[n] + 2δ[n-1]
+ 4δ[n-2] -

[Truncated for analysis]

### Key points

- For FIR filters, coefficients $b_k$ can be replaced by impulse response values $h[k]$.
- The FIR convolution formula is $y[n]=\sum_{k=0}^{M}h[k]x[n-k]$.
- An equivalent finite form is $y[n]=\sum_{k=0}^{M}h[n-k]x[k]$.
- For general LTI systems, $y[n]=\sum_{k=-\infty}^{\infty}x[k]h[n-k]$.
- The convolution operator is denoted by $*$, so $y[n]=x[n]*h[n]$.
- The notes state that convolution output length equals signal length plus filter order.

### Related topics

- [[discrete-unit-impulse-sequence|Discrete Unit Impulse Sequence]]
- [[unit-impulse-response-of-an-fir-filter|Unit Impulse Response of an FIR Filter]]
- [[properties-of-convolution|Properties of Convolution]]
- [[cascaded-discrete-time-lti-systems|Cascaded Discrete-Time LTI Systems]]
- [[equivalent-representations-of-fir-filters|Equivalent Representations of FIR Filters]]

### Relationships

- related: [[properties-of-convolution|Properties of Convolution]]
- part-of: [[equivalent-representations-of-fir-filters|Equivalent Representations of FIR Filters]]
