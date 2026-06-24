---
title: "Sampling Continuous-Time Signals into Discrete-Time Sequences"
date: "2026-04-30T16:26:39.261Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "signals-and-systems-full-notes"
source_file: "Signals and Systems full notes.pdf"
locations: ["Page 16"]
related: ["sampling-sinusoidal-signals", "discrete-time-aliases-and-principal-frequency", "shannon-sampling-theorem-and-ideal-reconstruction"]
tags: ["sampling", "discrete-time-signal", "sampling-rate", "sampling-period", "ideal-c-to-d-converter", "samples"]
source_images: ["/signals-and-systems/assets/signals-and-systems-full-notes-page-016.png"]
---

## Sampling Continuous-Time Signals into Discrete-Time Sequences

Source: [[signals-and-systems-full-notes|Signals and Systems Full Notes: Sinusoids, Spectra, Sampling, Aliasing, and FIR Filters]]

Locations: Page 16

Sampling converts a continuous-time analog signal into a discrete-time sequence by evaluating it at isolated time instants. A continuous-time signal is modeled as a real-valued function $x(t)$, while a discrete-time signal is represented as an indexed sequence $x[n]$, where $n$ is an integer index that indicates sample order. Uniform sampling uses equally spaced times $t_n=nT_s$, producing $x[n]=x(nT_s)$ for $-\infty<n<\infty$. The sample interval $T_s$ can be equivalently expressed through the sampling rate $f_s=1/T_s$, measured in samples per second, so $x[n]=x(n/f_s)$. The notes represent sampling as an ideal continuous-to-discrete converter, with input $x(t)$, sampling period $T_s$, and output $x[n]=x(nT_s)$. This transformation is treated as a system in engineering because it maps an input signal to an output signal. The notes distinguish discrete-time signals, where time is discrete but amplitudes are still treated as real numbers, from fully digital storage where finite precision also matters.

### Source snapshots

![Signals and Systems full notes Page 16](/signals-and-systems/assets/signals-and-systems-full-notes-page-016.png)

### Page-grounded details

#### Page 16

Chapter 3: Sampling and Aliasing

3.1 Sampling

Continuous-time (analog) signals are modeled as real valued functions
of a real time variable, x(t). Although such signals are important
actors in both time and amplitude, their representation on a digital
computer is necessarily discrete: values are sampled at isolated time
instants and stored with finite precision. In this notebook, we
focus on discrete time signals, where time is discrete but signal
amplitudes are still treated as real numbers.

A discrete time signal is represented mathematically by an indexed
sequence of numbers. We denote the values of discrete time signal as

        x[n]    where n is the integer index indicating the order of values
                in the sequence.

We can sample a continuous time signal at equally spaced time instants
tₙ = nTₛ, that is

        x[n] = x(nTₛ)        -∞ < n < ∞

where x(t) is any analog signal. The individual values of x[n]
are called samples of the continuous time signal.

The fixed time interval between samples, Tₛ, can also be expressed as
a fixed sampling rate, fₛ.

        fₛ = 1/Tₛ    samples per second

∴      x[n] = x(n/fₛ)

[Diagram: a block diagram showing input signa

[Truncated for analysis]

### Key points

- Continuous-time signals are modeled as real-valued functions $x(t)$
- Discrete-time signals are indexed sequences $x[n]$
- The index $n$ is an integer indicating order in the sequence
- Uniform sampling uses $t_n=nT_s$
- Samples are defined by $x[n]=x(nT_s)$
- The sampling rate is $f_s=1/T_s$ samples per second
- Equivalently, $x[n]=x(n/f_s)$
- Sampling is represented by an ideal C-to-D converter block

### Related topics

- [[sampling-sinusoidal-signals|Sampling Sinusoidal Signals]]
- [[discrete-time-aliases-and-principal-frequency|Discrete-Time Aliases and Principal Frequency]]
- [[shannon-sampling-theorem-and-ideal-reconstruction|Shannon Sampling Theorem and Ideal Reconstruction]]

