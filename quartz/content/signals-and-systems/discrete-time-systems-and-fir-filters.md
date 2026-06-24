---
title: "Discrete-Time Systems and FIR Filters"
date: "2026-04-30T16:26:39.261Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "signals-and-systems-full-notes"
source_file: "Signals and Systems full notes.pdf"
locations: ["Page 26"]
related: ["running-average-fir-filter", "general-causal-fir-filter-equation", "sampling-continuous-time-signals-into-discrete-time-sequences"]
tags: ["discrete-time-systems", "fir-filters", "finite-impulse-response", "linear-time-invariant-systems", "operator-t", "sequence"]
---

## Discrete-Time Systems and FIR Filters

Source: [[signals-and-systems-full-notes|Signals and Systems Full Notes: Sinusoids, Spectra, Sampling, Aliasing, and FIR Filters]]

Locations: Page 26

A discrete-time system transforms an input sequence into an output sequence through a computational process. The notes use the notation $x[n]\xrightarrow{T}y[n]$ to state that an operator $T$ maps the input sequence $x$ to the output sequence $y$. Since a discrete-time signal is a sequence of values, the operator can be described by a formula for computing each output value from input values. A simple example is $y[n]=(x[n])^2$, where each output sample is the square of the corresponding input sample. Discrete-time systems operate entirely on discrete-time signals, unlike sampling and reconstruction systems that convert between continuous and discrete time. The notes place such systems inside a broader processing chain where $x(t)$ is sampled by a C/D block, processed by $T$, and reconstructed by a D/C block. The chapter begins the study of FIR filters, described as finite impulse response filters and as a very important class of discrete-time systems that are part of linear time-invariant systems.

### Page-grounded details

#### Page 26

Chapter 4: FIR Filters:

4.1 Discrete Time Systems

A discrete-time system transforms an input sequence into an output
sequence through a computational process. These systems are commonly
represented as block diagrams. Unlike sampling and reconstruction,
where one of the signals is continuous time, discrete time systems operate
entirely on discrete-time signals. They are important because they
can be implemented digitally and designed to modify signals in useful ways.

In general, we represent the notation of a system by the notation:

x[n] ──T──> y[n]

which states concisely that the output sequence (the term sequence
is equivalent to a discrete time signal) y is related to the input sequence
x by a computational process (or mapping) that can be described mathematically
by an operator T. An equivalent representation is

[diagram: continuous-time input x(t) enters a C/D block, labeled with sampling frequency fs underneath; output x[n] goes into a block labeled T; output y[n] goes into a D/C block, labeled with sampling frequency fs underneath; final output is y(t). Arrows connect left to right.]

Since a discrete time signal is a sequence of values, such operators T
can be describe

[Truncated for analysis]

### Key points

- A discrete-time system maps an input sequence to an output sequence
- System notation is $x[n]\xrightarrow{T}y[n]$
- $T$ is an operator or computational mapping
- Output values are computed from input sequence values
- Example system: $y[n]=(x[n])^2$
- Discrete-time systems operate entirely on discrete-time signals
- A processing chain may include C/D conversion, a discrete-time system, and D/C conversion
- FIR filters are finite impulse response filters and part of linear time-invariant systems

### Related topics

- [[running-average-fir-filter|Running-Average FIR Filter]]
- [[general-causal-fir-filter-equation|General Causal FIR Filter Equation]]
- [[sampling-continuous-time-signals-into-discrete-time-sequences|Sampling Continuous-Time Signals into Discrete-Time Sequences]]

### Relationships

- related: [[sampling-continuous-time-signals-into-discrete-time-sequences|Sampling Continuous-Time Signals into Discrete-Time Sequences]]
