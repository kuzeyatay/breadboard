---
title: "Properties of Convolution"
date: "2026-04-30T16:26:39.261Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "signals-and-systems-full-notes"
source_file: "Signals and Systems full notes.pdf"
locations: ["Page 33"]
related: ["discrete-convolution-sum", "discrete-time-linearity-and-time-invariance", "cascaded-discrete-time-lti-systems"]
tags: ["convolution", "commutative-property", "associativity", "distributive-property", "linear-operator"]
---

## Properties of Convolution

Source: [[signals-and-systems-full-notes|Signals and Systems Full Notes: Sinusoids, Spectra, Sampling, Aliasing, and FIR Filters]]

Locations: Page 33

The notes list core algebraic properties of discrete convolution and then prove that convolution with a fixed impulse response is a linear operator. The identity property states that convolution with the unit impulse does nothing: $x[n]*\delta[n]=x[n]$. Commutativity allows the order of two convolved sequences to be swapped. A shifted impulse delays the signal: convolution with $\delta[n-n_0]$ gives $x[n-n_0]$. Associativity allows grouped cascades of convolution operations to be rearranged, and distributivity allows convolution to distribute over addition. Linearity is shown by defining a system $T:x[n]\mapsto y[n]$ and proving that $T\{ax_1+bx_2\}=aT\{x_1\}+bT\{x_2\}$. These properties justify later results, including cascaded LTI equivalence and superposition-based signal decomposition.

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

### Key points

- Identity: $x[n]*\delta[n]=x[n]$.
- Commutativity: $x_1[n]*x_2[n]=x_2[n]*x_1[n]$.
- Shifted impulse convolution delays the signal.
- Associativity permits regrouping of multiple convolutions.
- Distributivity permits convolution across sums.
- Convolution with a fixed impulse response is a linear operator.

### Related topics

- [[discrete-convolution-sum|Discrete Convolution Sum]]
- [[discrete-time-linearity-and-time-invariance|Discrete-Time Linearity and Time Invariance]]
- [[cascaded-discrete-time-lti-systems|Cascaded Discrete-Time LTI Systems]]

### Relationships

- applies-to: [[cascaded-discrete-time-lti-systems|Cascaded Discrete-Time LTI Systems]]
