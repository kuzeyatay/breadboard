---
title: "Causal and Noncausal Running-Average Filters"
date: "2026-04-30T16:26:39.261Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "signals-and-systems-full-notes"
source_file: "Signals and Systems full notes.pdf"
locations: ["Page 28", "Page 29"]
related: ["running-average-fir-filter", "general-causal-fir-filter-equation", "discrete-time-systems-and-fir-filters"]
tags: ["causal-filter", "noncausal-filter", "running-average", "sliding-window", "real-time-application", "difference-equation"]
---

## Causal and Noncausal Running-Average Filters

Source: [[signals-and-systems-full-notes|Signals and Systems Full Notes: Sinusoids, Spectra, Sampling, Aliasing, and FIR Filters]]

Locations: Page 28, Page 29

The indexing convention of a running-average filter determines whether it is causal or noncausal. The equation $y[n]=\frac{1}{3}(x[n]+x[n+1]+x[n+2])$ uses present and future input values relative to index $n$, so it is noncausal when $n$ represents time. A noncausal filter cannot be implemented in real time because future input samples are unavailable when the output must be computed. The notes describe the running average as a sliding window of three samples that determines which values are used for each output. A causal 3-point running average instead uses the present and past values: $y[n]=\frac{1}{3}(x[n]+x[n-1]+x[n-2])$. This can also be written as a sum over $l$ from $n-2$ to $n$, or as $y[n]=\sum_{k=0}^{2}\frac{1}{3}x[n-k]$. The same averaging idea is preserved, but the indexing makes the filter realizable in real-time applications.

### Page-grounded details

#### Page 28

The equation given in (1) is called a difference equation. It is a complete
description of the FIR system

involved in the computation for y[2]

```
 n      -4 -3 -2 -1  0  1  2  3  4  5  ∞
x[n]     0  0  0  2  4  6  4  2  0  0
y[n]     0  1/3 2  4  1/3 4  2  2/3 0 0
```

Observe that the support of the output sequence is longer than the input sequence
which is typical for an FIR filter.

The choice of the output indexing is arbitrary, but it does matter when speaking
about properties of the filter because n is often time index. We can interpret
y[n] in (1) as the computation of the present value of the output based on
three input values and since these inputs are indexed as n, n+1, and n+2,
two of them are "in the future". This form of the 3 point running average
filter can be represented by

```
y[n] = 1/3 (x[n] + x[n+1] + x[n+2]) = 1/3 sum x[l]
                                            l=n
                                            n+2
```

Where l is a "dummy" counting index for the sum and n denotes the index of the
nth sample.

In general, sample values from either the past or the future or both may
be used in the computation of the running average.

In all cases of a 3-po

[Truncated for analysis]

#### Page 29

The straightforward manipulation of the sum (2) can also be expressed

y[n] = 1/3 ( x[n] + x[n-1] + x[n-2] ) = sum from k=0 to 2 1/3 x[n-k]   (3)


4.3 The General FIR Filter

The causal running average (3) is a special case of the general causal
difference equation, with given M in reverse-time order (newest -> oldest)

y[n] = sum from k=0 to M bₖ x[n-k] = b_0 x[n] + b_1 x[n-1] + ... + bM x[n-M]

where the coefficients bₖ are fixed numbers. (usually the bₖ
coefficients are not all the same).

Visually; for a list of values {2, 4, 6, 8, 10}

filter coefficients        b_0      b_1      b_2      ...
samples reverse chronological
                           x[0]    x[-1]   x[-2]   ...
                           x[3]    x[2]    x[1]
                           6       4       2

∴ b_0 * 6 + b_1 * 4 + b_2 * 2


Now list the samples in time order (oldest -> newest):

y[n] = sum from k=0 to M bM-k x[k] = bM x[n-M] + bM-1 x[n-M+1] + ... + b_0 x[n]

Visually:

filter coefficients reversed     b_2      b_1      b_0
samples chronological order
                                  x[n-2]  x[n-1]  x[n]
                                  x[1]    x[2]    x[3]
                                  2

[Truncated for analysis]

### Key points

- A filter using future input values is noncausal
- The equation $y[n]=\frac{1}{3}(x[n]+x[n+1]+x[n+2])$ is noncausal
- Noncausal systems cannot be implemented in real time
- A causal filter uses only present and past input values
- The causal 3-point average is $y[n]=\frac{1}{3}(x[n]+x[n-1]+x[n-2])$
- The sliding window determines the three input samples used
- The causal form can be written as $\sum_{k=0}^{2}\frac{1}{3}x[n-k]$
- Output indexing matters because $n$ is often a time index

### Related topics

- [[running-average-fir-filter|Running-Average FIR Filter]]
- [[general-causal-fir-filter-equation|General Causal FIR Filter Equation]]
- [[discrete-time-systems-and-fir-filters|Discrete-Time Systems and FIR Filters]]

### Relationships

- part-of: [[running-average-fir-filter|Running-Average FIR Filter]]
