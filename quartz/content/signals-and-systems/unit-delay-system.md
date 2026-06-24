---
title: "Unit Delay System"
date: "2026-04-30T16:26:39.261Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "signals-and-systems-full-notes"
source_file: "Signals and Systems full notes.pdf"
locations: ["Page 31", "Page 34"]
related: ["unit-impulse-response-of-an-fir-filter", "fir-filter-implementation-blocks", "equivalent-representations-of-fir-filters"]
tags: ["unit-delay", "delay-system", "fir-filter", "impulse-response"]
---

## Unit Delay System

Source: [[signals-and-systems-full-notes|Signals and Systems Full Notes: Sinusoids, Spectra, Sampling, Aliasing, and FIR Filters]]

Locations: Page 31, Page 34

The unit delay system shifts a discrete-time signal by one sample. More generally, a delay by $n_0$ is described by $y[n]=x[n-n_0]$. When $n_0=1$, the system is called a unit delay. The notes emphasize that a delay system is the simplest FIR filter because it has only one nonzero coefficient. For example, with coefficients $\{b_0,b_1,b_2\}=\{0,0,1\}$ and order $M=2$, the difference equation becomes $y[n]=x[n-2]$. The corresponding impulse response is $h[n]=\delta[n-2]$, meaning that the system's entire behavior is a two-sample delay. In FIR block diagrams, unit delays appear as delay blocks labeled $T$ and are used to create delayed versions of the input for tapped-delay-line filtering.

### Page-grounded details

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

- A delay by $n_0$ is represented by $y[n]=x[n-n_0]$.
- When $n_0=1$, the system is a unit delay.
- A pure delay is an FIR filter with a single nonzero coefficient.
- The coefficient set $\{0,0,1\}$ produces $y[n]=x[n-2]$.
- The impulse response of a two-sample delay is $h[n]=\delta[n-2]$.
- Delay blocks provide delayed input samples in FIR implementations.

### Related topics

- [[unit-impulse-response-of-an-fir-filter|Unit Impulse Response of an FIR Filter]]
- [[fir-filter-implementation-blocks|FIR Filter Implementation Blocks]]
- [[equivalent-representations-of-fir-filters|Equivalent Representations of FIR Filters]]

### Relationships

- part-of: [[fir-filter-implementation-blocks|FIR Filter Implementation Blocks]]
- example-of: [[unit-impulse-response-of-an-fir-filter|Unit Impulse Response of an FIR Filter]]
