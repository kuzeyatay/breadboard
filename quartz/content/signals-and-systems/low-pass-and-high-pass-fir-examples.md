---
title: "Low-Pass and High-Pass FIR Examples"
date: "2026-04-30T16:26:39.261Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "signals-and-systems-full-notes"
source_file: "Signals and Systems full notes.pdf"
locations: ["Page 38", "Page 39", "Page 40"]
related: ["discrete-convolution-sum", "discrete-unit-step-signal", "continuous-time-lti-system-properties"]
tags: ["low-pass", "high-pass", "c-d", "d-c", "sampling-frequency", "fir-filter"]
---

## Low-Pass and High-Pass FIR Examples

Source: [[signals-and-systems-full-notes|Signals and Systems Full Notes: Sinusoids, Spectra, Sampling, Aliasing, and FIR Filters]]

Locations: Page 38, Page 39, Page 40

The notes use simple two-tap FIR filters to demonstrate frequency-selective behavior. The filter $h_1[n]=\delta[n]+\delta[n-1]$ adds the current and previous sample, so for a constant input $x_1(t)=1$ sampled at $f_s=100$ Hz, the output is $2$. For the high-frequency sampled cosine $x_2[n]=\cos(\pi n)$, the same filter gives $\cos(\pi n)+\cos(\pi n-\pi)=0$, so it attenuates this high-frequency component. The filter $h_2[n]=\delta[n]-\delta[n-1]$ subtracts the previous sample, so it cancels a constant input but doubles the alternating cosine: $\cos(\pi n)-\cos(\pi n-\pi)=2\cos(\pi n)$. Based on these results, $h_1$ is identified as low-pass and $h_2$ as high-pass. The examples are framed through C/D and D/C conversion, showing how discrete-time LTI systems can process continuous-time signals after sampling.

### Page-grounded details

#### Page 38

we can now clearly see that all LTI systems are defined by
the discrete convolution sum.

y[n] = x[n] * h[n] = sum from k=-∞ to ∞ x[k] * h[n-k]

where y[n] is the output sequence, x[n] is the input sequence and h[n] is
the unit impulse response. Sequence where δ[n-k] is the basis for these sequences


ex/
Let x[n] = 2δ[n] + 4δ[n-1] + 6δ[n-2] - δ[n-4]

[diagram: x[n] enters a branching discrete-time system. The top path has two delay blocks labeled T and T in series. A middle tap from between the two T blocks goes down through a multiplier marked x with a minus sign. The original input also branches along a lower path to a summing junction marked +. The outputs combine at a final summing junction marked +, producing y[n].]

h[n] = δ[n] - δ[n-1] + δ[n-2]

DE: y[n] = x[n] - x[n-1] + x[n-2]

Find the sequence y[n].


Solution: Since we know the input and filter sequences, we use the
tabular method

[table]
h[n]        1      -1      +1
x[n]
2           2      -2      2
4           4      -4      4
6           6      -6      6
0           0       0      0
-1         -1       1     -1

y[0] = 2
y[1] = 2
y[2] = 4
y[3] = -2
y[4] = 5
y[5] = 1
y[6] = -1

∴ y[n] = 2δ[n] + 2δ[n-1]
+ 4δ[n-2] -

[Truncated for analysis]

#### Page 39

Since we have two cosines with same phases, we can do phasor addition

1 cos(1/2 n) + cos(1/2 n - π/2)

= 1/2 (1 + e^-jπ/2)

= 1 + -j

= 1 - j        |z| = √(1+1) = √2,    θ = arctan(-1/1) = arctan(-1) = -π/4

= [√2 e^-jπ/4] * 1/2

∴ y[n] = √2 cos(1/2 n - π/4)

∴ y(t) = √2 cos(1/2 200t - π/4)

= √2 cos(2π50t - π/4)


[diagram: FIR tapped-delay filter. Input labeled x[n] = u[n] enters a horizontal delay line. Four vertical taps go down through multiplier circles labeled b0, b1, b2, b3, into a summing block Σ. Three delay blocks labeled T are placed along the top delay line between taps. Output from Σ goes right.]

h[n] = b0 δ[n] + b1 δ[n-1] + b2 δ[n-2] + b3 δ[n-3] - find the multipliers b0 ... b3 (filter coefficients)

down Solution: u[n] * h[n] = δ[n] - δ[n-1] - δ[n-2] + δ[n-3]

u[n] * h[n] = u[n] - u[n-1] - u[n-1] + u[n-2] - u[n-2] + u[n-3]

= u[n] - 2u[n-1] + 0u[n-2] + u[n-3]

∴ b0 = 1, b1 = -2, b2 = 0, b3 = 1

-> infinite impulse order 3. FIR filter is filtering the discrete unit step [unclear]

#### Page 40

Let consider the system

[diagram: input arrow labeled x(t) enters a block labeled C/D. An upward arrow into the C/D block is labeled fs = 100 Hz. Output arrow labeled x[n] enters a block labeled "T / system" (discrete-time system). Output arrow labeled y[n] enters a block labeled D/C. An upward arrow into the D/C block is labeled fs = 100 Hz. Output arrow labeled y(t).]

which is a discrete time LTI system that can be used to process various
time signals (using C/D and D/C converters). The sampling frequency of
both converters is 100 Hz. Compute the output signal y(t) for the
following situations.

a) x1(t) = 1 and h1[n] = δ[n] + δ[n-1]

b) x1(t) = 1 and h2[n] = δ[n] - δ[n-1]

c) x2(t) = cos(100πt) and h1[n] = δ[n] + δ[n-1]

d) x2(t) = cos(100πt) and h2[n] = δ[n] - δ[n-1]

Based on these results, explain the behaviour of both filters h1(n) and h2(n)
for the two given frequencies, x1(t)(DC) and x2(t).

down a/c

h1[n] = δ[n] + δ[n-1]

[diagram: input arrow labeled x[n] branches. One branch goes through a delay block labeled T; the delayed branch and direct branch enter a summing node marked +, output labeled y1[n]. Dashed box labeled "the LTI system h1[n]".]

- x1(t) -> x1[n]
= 1 -

[Truncated for analysis]

### Key points

- $h_1[n]=\delta[n]+\delta[n-1]$ computes $y[n]=x[n]+x[n-1]$.
- For a constant input, $h_1$ outputs $2$.
- For $x_2[n]=\cos(\pi n)$, $h_1$ outputs zero.
- $h_2[n]=\delta[n]-\delta[n-1]$ computes $y[n]=x[n]-x[n-1]$.
- For a constant input, $h_2$ outputs zero.
- For $x_2[n]=\cos(\pi n)$, $h_2$ outputs $2\cos(\pi n)$.

### Related topics

- [[discrete-convolution-sum|Discrete Convolution Sum]]
- [[discrete-unit-step-signal|Discrete Unit Step Signal]]
- [[continuous-time-lti-system-properties|Continuous-Time LTI System Properties]]

### Relationships

- applies-to: [[discrete-convolution-sum|Discrete Convolution Sum]]
- applies-to: [[discrete-unit-step-signal|Discrete Unit Step Signal]]
