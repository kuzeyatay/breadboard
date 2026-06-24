---
title: "General Causal FIR Filter Equation"
date: "2026-04-30T16:26:39.261Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "signals-and-systems-full-notes"
source_file: "Signals and Systems full notes.pdf"
locations: ["Page 29"]
related: ["causal-and-noncausal-running-average-filters", "running-average-fir-filter", "discrete-time-systems-and-fir-filters"]
tags: ["general-fir-filter", "causal-difference-equation", "filter-coefficients", "sliding-window", "reverse-time-order", "chronological-order"]
---

## General Causal FIR Filter Equation

Source: [[signals-and-systems-full-notes|Signals and Systems Full Notes: Sinusoids, Spectra, Sampling, Aliasing, and FIR Filters]]

Locations: Page 29

The causal running-average filter is a special case of the general causal FIR filter. The general difference equation is $y[n]=\sum_{k=0}^{M}b_kx[n-k]=b_0x[n]+b_1x[n-1]+\cdots+b_Mx[n-M]$, where the coefficients $b_k$ are fixed numbers and are not usually all the same. This equation computes the present output from the present input and $M$ past input samples, making it causal. The notes emphasize coefficient and sample ordering. In reverse-time order, newest to oldest, the samples line up as $x[n]$, $x[n-1]$, $x[n-2]$, with coefficients $b_0$, $b_1$, $b_2$. For example, using samples $6$, $4$, and $2$ gives $b_0\cdot6+b_1\cdot4+b_2\cdot2$. In chronological order, oldest to newest, the expression can be written as $b_Mx[n-M]+b_{M-1}x[n-M+1]+\cdots+b_0x[n]$. The diagrams show a sliding window over samples with filter coefficients applied to the selected block.

### Page-grounded details

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

- The causal running average is a special case of a general causal FIR filter
- General form: $y[n]=\sum_{k=0}^{M}b_kx[n-k]$
- Expanded form: $b_0x[n]+b_1x[n-1]+\cdots+b_Mx[n-M]$
- $b_k$ are fixed filter coefficients
- Coefficients are usually not all the same
- Reverse-time order aligns newest sample with $b_0$
- Chronological order aligns oldest sample with $b_M$
- A sliding window selects the input samples used in each output computation

### Related topics

- [[causal-and-noncausal-running-average-filters|Causal and Noncausal Running-Average Filters]]
- [[running-average-fir-filter|Running-Average FIR Filter]]
- [[discrete-time-systems-and-fir-filters|Discrete-Time Systems and FIR Filters]]

### Relationships

- depends-on: [[causal-and-noncausal-running-average-filters|Causal and Noncausal Running-Average Filters]]
