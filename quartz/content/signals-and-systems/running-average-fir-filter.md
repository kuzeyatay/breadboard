---
title: "Running-Average FIR Filter"
date: "2026-04-30T16:26:39.261Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "signals-and-systems-full-notes"
source_file: "Signals and Systems full notes.pdf"
locations: ["Page 27", "Page 28"]
related: ["discrete-time-systems-and-fir-filters", "causal-and-noncausal-running-average-filters", "general-causal-fir-filter-equation"]
tags: ["running-average-filter", "moving-average", "fir-system", "difference-equation", "finite-length-signal", "support"]
---

## Running-Average FIR Filter

Source: [[signals-and-systems-full-notes|Signals and Systems Full Notes: Sinusoids, Spectra, Sampling, Aliasing, and FIR Filters]]

Locations: Page 27, Page 28

The running-average filter is introduced as a motivating FIR system. In a 3-point running average, each output sample is computed by summing three consecutive input samples and dividing by three. For the finite-length input sequence shown with nonzero samples $x[0]=2$, $x[1]=4$, $x[2]=6$, $x[3]=4$, and $x[4]=2$, the support is the finite interval $0\le n\le4$. A 3-point average of $\{x[0],x[1],x[2]\}=\{2,4,6\}$ gives $y[0]=4$, and averaging $\{x[1],x[2],x[3]\}$ gives $y[1]=14/3$. The notes choose one possible indexing convention and write the difference equation $y[n]=\frac{1}{3}(x[n]+x[n+1]+x[n+2])$. This equation completely describes the FIR system. The output support is longer than the input support, which the notes identify as typical for an FIR filter. Running average is also called moving average.

### Page-grounded details

#### Page 27

4.2 The Running-Average Filter

- In order to motivate the general definition of the class of
FIR systems, let us consider the simple running average as an example
of a system that processes an input sequence to produce an output sequence.
To be specific, consider a 3-point running average where each sample
(of current practice, or referred to signal values as point or samples)
of the output sequence is the sum of three consecutive input sequence
samples divided by three.

[Diagram: stem plot labeled x[n]. Horizontal axis labeled n with tick marks -2, -1, 0, 1, 2, 3, 4, 5, 6. Nonzero samples shown at n = 0 with value 2, n = 1 with value 4, n = 2 with value 6, n = 3 with value 4, n = 4 with value 2. Vertical axis arrow upward labeled x[n].]

- If we apply this algorithm to the example
short sequence shown in the top figure we
can compute a new sequence (called y[n]) which
is the output of the averaging processor.

- The sequence x[n] is an example of a
finite-length signal. The support of such a
sequence is the set of indices over which the
sequence is nonzero. In this case, the support
of the sequence is the finite interval 0 <= n <= 4.
[a finite-length sequence]

[Diagram: stem pl

[Truncated for analysis]

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

### Key points

- A 3-point running average sums three consecutive input samples and divides by three
- The input example has nonzero samples $2,4,6,4,2$ at indices $0$ through $4$
- The support of a finite-length sequence is the set of nonzero indices
- The example input support is $0\le n\le4$
- Averaging $\{2,4,6\}$ gives output value $4$
- Averaging $\{4,6,4\}$ gives output value $14/3$
- One difference equation is $y[n]=\frac{1}{3}(x[n]+x[n+1]+x[n+2])$
- Running average is also named moving average

### Related topics

- [[discrete-time-systems-and-fir-filters|Discrete-Time Systems and FIR Filters]]
- [[causal-and-noncausal-running-average-filters|Causal and Noncausal Running-Average Filters]]
- [[general-causal-fir-filter-equation|General Causal FIR Filter Equation]]

### Relationships

- example-of: [[discrete-time-systems-and-fir-filters|Discrete-Time Systems and FIR Filters]]
- example-of: [[general-causal-fir-filter-equation|General Causal FIR Filter Equation]]
