---
title: "FIR Filter Implementation Blocks"
date: "2026-04-30T16:26:39.261Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "signals-and-systems-full-notes"
source_file: "Signals and Systems full notes.pdf"
locations: ["Page 33", "Page 34"]
related: ["unit-delay-system", "equivalent-representations-of-fir-filters", "unit-impulse-response-of-an-fir-filter"]
tags: ["fir-filter", "multiplier", "adder", "unit-delay", "block-diagram"]
---

## FIR Filter Implementation Blocks

Source: [[signals-and-systems-full-notes|Signals and Systems Full Notes: Sinusoids, Spectra, Sampling, Aliasing, and FIR Filters]]

Locations: Page 33, Page 34

An FIR filter can be implemented using three basic operations: multiplication by coefficients, addition of scaled signals, and delay of input samples. The notes introduce block diagrams for a multiplier, an adder, and a unit delay. A multiplier produces $y[n]=\beta x[n]$, an adder produces $y[n]=x_1[n]+x_2[n]$, and a unit delay produces $y[n]=x[n-1]$. These blocks combine into a tapped-delay-line realization of an FIR filter, where each delayed version of the input is multiplied by a coefficient and the products are summed. For a third-order FIR filter, the block diagram contains four taps and three unit delays, giving $y[n]=b_0x[n]+b_1x[n-1]+b_2x[n-2]+b_3x[n-3]$. This diagrammatic realization is one of four equivalent FIR descriptions: realization scheme, difference equation, impulse response, and convolution.

### Page-grounded details

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

### Key points

- FIR implementation requires multipliers, adders, and delay elements.
- A multiplier block computes $y[n]=\beta x[n]$.
- An adder block computes $y[n]=x_1[n]+x_2[n]$.
- A unit-delay block computes $y[n]=x[n-1]$.
- A third-order FIR filter uses four coefficients and three delays.
- The tapped-delay-line form realizes the FIR difference equation.

### Related topics

- [[unit-delay-system|Unit Delay System]]
- [[equivalent-representations-of-fir-filters|Equivalent Representations of FIR Filters]]
- [[unit-impulse-response-of-an-fir-filter|Unit Impulse Response of an FIR Filter]]

### Relationships

- part-of: [[equivalent-representations-of-fir-filters|Equivalent Representations of FIR Filters]]
