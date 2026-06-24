---
title: "Discrete Unit Step Signal"
date: "2026-04-30T16:26:39.261Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "signals-and-systems-full-notes"
source_file: "Signals and Systems full notes.pdf"
locations: ["Page 32", "Page 37"]
related: ["discrete-unit-impulse-sequence", "discrete-convolution-sum", "low-pass-and-high-pass-fir-examples"]
tags: ["unit-step", "shifted-unit-step", "unit-impulse", "pulse"]
---

## Discrete Unit Step Signal

Source: [[signals-and-systems-full-notes|Signals and Systems Full Notes: Sinusoids, Spectra, Sampling, Aliasing, and FIR Filters]]

Locations: Page 32, Page 37

The discrete unit step signal $u[n]$ is an infinite-duration signal that is zero before the origin and one from the origin onward. It extends the notes beyond finite-length FIR input signals by showing that filtering can be applied to infinite-duration sequences. The unit step is defined as $u[n]=0$ for $n<0$ and $u[n]=1$ for $n\geq0$. Shifted unit steps can be subtracted to build finite rectangular pulses; for example, $x[n]=u[n-100]-u[n-105]$ is a length-5 pulse starting at $n=100$. The notes also connect the unit step to the impulse through the identity $\delta[n]=u[n]-u[n-1]$. This identity is repeatedly used to solve FIR and LTI examples involving steps, impulses, and unknown impulse responses.

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

#### Page 37

ex/ let x[n] = u[n] and h[n] = δ[n] - δ[n-2].

a) how many filter coefficients?

√ 3.  Σ bₖ z⁻ᵏ = 1 0 -1  3

b) what is the output of the system, y[n] = ?

x[n] * h[n] = x[n] * (δ[n] - δ[n-2])

= u[n] * δ[n] - u[n] * δ[n-2]

= u[n] - u[n-2]

which looks like

[graph: horizontal discrete-time axis labeled -3, -2, -1, 0, 1, 2, 3, 4; two vertical stems at n=0 and n=1 with filled dots at height 1; other points on axis]

which is a length 2 pulse at index n=0

(
[graph: unit step-like sequence with stems starting at n=0 and continuing to the right, axis labeled -2, -1, 0, 1, 2, 3, with ellipsis]

-

[graph: shifted unit step-like sequence with stems starting at n=2 and continuing to the right, axis labeled -2, -1, 0, 1, 2, 3, with ellipsis]
)

ex/

x[n]  ->  [LTI system]  ->  y[n]

if x[n] = u[n]  ->  y[n] = δ[n] + 2δ[n-1]
what is the impulse response? positive sequence

√  x[n] * h[n] = δ[n] + 2δ[n-1]

u[n] * h[n] = δ[n] + 2δ[n-1]

using the identity δ[n] = u[n] - u[n-1]

u[n] * h[n] = u[n] - u[n-1] + 2u[n-1] + 2u[n-2]

∴ h[n] = δ[n] + δ[n-1] + 2δ[n-2]

### Key points

- The unit step $u[n]$ is zero for $n<0$ and one for $n\geq0$.
- The symbol $u[n]$ is reserved for the unit step.
- Unit steps represent infinite-duration inputs.
- Differences of shifted steps can form finite pulses.
- $u[n-100]-u[n-105]$ is a length-5 pulse beginning at $n=100$.
- The impulse-step identity is $\delta[n]=u[n]-u[n-1]$.

### Related topics

- [[discrete-unit-impulse-sequence|Discrete Unit Impulse Sequence]]
- [[discrete-convolution-sum|Discrete Convolution Sum]]
- [[low-pass-and-high-pass-fir-examples|Low-Pass and High-Pass FIR Examples]]

### Relationships

- related: [[discrete-unit-impulse-sequence|Discrete Unit Impulse Sequence]]
