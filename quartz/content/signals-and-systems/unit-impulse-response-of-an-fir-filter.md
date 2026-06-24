---
title: "Unit Impulse Response of an FIR Filter"
date: "2026-04-30T16:26:39.261Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "signals-and-systems-full-notes"
source_file: "Signals and Systems full notes.pdf"
locations: ["Page 30", "Page 31"]
related: ["discrete-unit-impulse-sequence", "discrete-convolution-sum", "equivalent-representations-of-fir-filters"]
tags: ["unit-impulse-response", "fir-filter", "filter-coefficients", "three-point-running-average"]
---

## Unit Impulse Response of an FIR Filter

Source: [[signals-and-systems-full-notes|Signals and Systems Full Notes: Sinusoids, Spectra, Sampling, Aliasing, and FIR Filters]]

Locations: Page 30, Page 31

The unit impulse response is the output of a filter when the input is the unit impulse $\delta[n]$. The notes reserve the notation $h[n]$ for this sequence. For an FIR filter, the impulse response is exactly the sequence of difference-equation coefficients, so the coefficients $b_k$ can be read directly as samples of $h[n]$. This gives a complete characterization of the FIR filter because convolution computes the output for any input once $h[n]$ is known. Since an FIR filter has only finitely many nonzero coefficients, its impulse response is zero outside a finite interval, which is why it is called a finite impulse response system. The notes give the impulse response of a three-point running-average filter as three stems of height $1/3$ at $n=0,1,2$.

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

- A filter response is the output produced by a given input.
- The unit impulse response is the response when the input is $\delta[n]$.
- The notation $h[n]$ is reserved for the unit impulse response.
- For an FIR filter, $h[n]$ equals the sequence of filter coefficients.
- The impulse response of an FIR filter is finite in duration.
- A three-point running average has impulse response samples $1/3,1/3,1/3$.

### Related topics

- [[discrete-unit-impulse-sequence|Discrete Unit Impulse Sequence]]
- [[discrete-convolution-sum|Discrete Convolution Sum]]
- [[equivalent-representations-of-fir-filters|Equivalent Representations of FIR Filters]]

### Relationships

- depends-on: [[discrete-convolution-sum|Discrete Convolution Sum]]
- part-of: [[equivalent-representations-of-fir-filters|Equivalent Representations of FIR Filters]]
