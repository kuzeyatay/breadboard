---
title: "Discrete Unit Impulse Sequence"
date: "2026-04-30T16:26:39.261Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "signals-and-systems-full-notes"
source_file: "Signals and Systems full notes.pdf"
locations: ["Page 30", "Page 31"]
related: ["unit-impulse-response-of-an-fir-filter", "discrete-convolution-sum", "discrete-unit-step-signal"]
tags: ["kronecker-delta", "unit-impulse-sequence", "shifted-impulse", "discrete-time-sequence"]
---

## Discrete Unit Impulse Sequence

Source: [[signals-and-systems-full-notes|Signals and Systems Full Notes: Sinusoids, Spectra, Sampling, Aliasing, and FIR Filters]]

Locations: Page 30, Page 31

The discrete unit impulse sequence, also called the Kronecker delta, is the basic building block for representing discrete-time signals. It is defined to be one at the origin and zero everywhere else. A shifted impulse $\delta[n-k]$ is nonzero only when its argument is zero, so $\delta[n-2]$ has its only nonzero value at $n=2$. The notes use this fact to show that finite sequences can be decomposed into weighted and shifted impulses. For example, the sequence $x[n]=\{2,4,6,4,2\}$ with the first sample at $n=0$ can be written as $2\delta[n]+4\delta[n-1]+6\delta[n-2]+4\delta[n-3]+2\delta[n-4]$. More generally, any sequence can be represented as a sum over impulse basis elements: $x[n]=\sum_k x[k]\delta[n-k]$. This representation is foundational because LTI systems are fully characterized by how they respond to shifted impulses.

### Page-grounded details

#### Page 30

- When the input signal has length of N, the support of the signal
can be expressed as 0 <= k <= N-1. The periodic extension support of the signal then
is an interval of N samples at the origin where the convolution involves
fewer than M-1 nonzero samples as the sliding window of the filter edges
with the input and another M samples at the end where the sliding window
disengages from the input sequence.

The length of the output sequence would be N+M samples where N is the
length of the input signal, M-1 is the filter length and M is the filter order.

4.4 The Unit Impulse Response and Convolution

- In this section, we introduce three new concepts: the unit impulse
sequence, the unit impulse response and the convolution sum. We show that
the impulse response also provides a complete characterization
of the FIR filter, because convolution sum gives a formula
for computing the output from the input when the unit impulse response is
known.

=> Unit impulse Sequence

- The Kronecker delta δ[n] is a discrete-time sequence defined by

δ[n] = { 1, n=0
       { 0, n!=0

ex/

n       | -2 | -1 | 0 | 1 | 2 | 3
δ[n]    | 0  | 0  | 1 | 0 | 0 | 0
δ[n-2]  | 0  | 0  | 0 | 0 | 1 | 0

A shifted im

[Truncated for analysis]

#### Page 31

It turns out that any sequence can be represented this way.

x[n] = sumₖ x[k] δ[n-k]

= x[-1]δ[n+1] + x[0]δ[n] + x[1]δ[n-1] + ...

=> unit impulse response sequence

- The output from a filter is called the response to the input. so when
the input is the unit impulse, δ[n], the output is called the
unit impulse response

- We reserve the notation h[n] for the unit impulse response sequence

h[n] = sumᵏ⁼ᴹₖ₌_0 bₖ δ[n-k]

The impulse response h[n] of the FIR filter is simply the sequence
difference equation coefficients. (filter coefficients.)

Since, h[n] = 0 for n<0 and for n>M, the length of the impulse response
sequence h[n] is finite. This is why the system is called a FIR (finite impulse
response) system.

ex/   x[n]                         y[n]
      δ[n] -> [3-pt ave.
              FIR filter] ->       h[n]

[Graph: horizontal n-axis marked -3, -2, -1, 0, 1, 2, 3. Three vertical impulses at n=0, n=1, n=2, each labeled ⅓.]

- impulse
response of
a 3 point
running average
filter.

=> The unit Delay System

- One important system is the operator that performs a delay or shift
by an amount n_0

y[n] = x[n-n_0]

When n_0 = 1 the system is called a unit delay. The delay system is
ac

[Truncated for analysis]

### Key points

- The Kronecker delta is defined by $\delta[n]=1$ for $n=0$ and $\delta[n]=0$ for $n\neq0$.
- A shifted impulse $\delta[n-2]$ is nonzero when $n-2=0$, so it occurs at $n=2$.
- A finite sequence can be written as a weighted sum of shifted impulses.
- The general impulse expansion is $x[n]=\sum_k x[k]\delta[n-k]$.
- Impulse decomposition provides a basis representation for discrete-time sequences.
- This representation prepares the derivation of convolution for LTI systems.

### Related topics

- [[unit-impulse-response-of-an-fir-filter|Unit Impulse Response of an FIR Filter]]
- [[discrete-convolution-sum|Discrete Convolution Sum]]
- [[discrete-unit-step-signal|Discrete Unit Step Signal]]

### Relationships

- depends-on: [[unit-impulse-response-of-an-fir-filter|Unit Impulse Response of an FIR Filter]]
- depends-on: [[discrete-convolution-sum|Discrete Convolution Sum]]
