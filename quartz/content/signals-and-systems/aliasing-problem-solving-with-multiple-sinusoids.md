---
title: "Aliasing Problem Solving with Multiple Sinusoids"
date: "2026-04-30T16:26:39.261Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "signals-and-systems-full-notes"
source_file: "Signals and Systems full notes.pdf"
locations: ["Page 25"]
related: ["folding-due-to-under-sampling", "discrete-time-aliases-and-principal-frequency", "phasor-addition-of-same-frequency-cosines"]
tags: ["aliasing", "folding", "phasor", "sampling-rate", "principal-discrete-time-frequency", "f-2"]
---

## Aliasing Problem Solving with Multiple Sinusoids

Source: [[signals-and-systems-full-notes|Signals and Systems Full Notes: Sinusoids, Spectra, Sampling, Aliasing, and FIR Filters]]

Locations: Page 25

The notes solve for an unknown sinusoidal frequency by using aliasing and phasor addition after sampling. The given signal is $x(t)=4\cos(2\pi32t-\pi/6)+7\cos(2\pi f_2t-\pi/2)$ with $32<f_2<200$, sampled at $f_s=160$ Hz, and the observed discrete-time signal is $x[n]=3\cos(2\pi n/5+\pi/2)$. The known 32 Hz component maps to $\tilde{\omega}_1=2\pi(32/160)=2\pi/5$. A sum of two continuous-time cosines can sample into one discrete-time cosine only if their frequencies are equal or alias to the same principal discrete-time frequency, so aliasing must be responsible. The solution tests alias equations for the second frequency using both non-folded and folded possibilities. The non-folded candidate can yield $f_2=128$ Hz but gives a combined phasor corresponding to phase $-\pi/6$, which does not match the observed signal. The folded case combines phasors to produce $3\cos(2\pi n/5+\pi/2)$, and solving $-2\pi f_2/160+2\pi=2\pi/5$ gives $f_2=128$ Hz, which lies in the allowed interval.

### Page-grounded details

#### Page 25

reconstruction
down
rec/

```
x(t) ──► [ C/D ] ──► y(t)
             up
          fs = 160 Hz
```

let  x(t) = 4 cos(2π32t - π/6) + 7 cos(2πf_2t - π/2)

32 < f_2 < 200.   x[n] = 3 cos(2π/5 n + π/2), what is f_2?

Solution: A sum of two continuous-time cosines with the same phase can be
sampled into a single discrete time cosine if only if the two frequencies are
equal and not cos it at, or they alias to the same principal discrete-time
frequency.

∴ Aliasing has occurred.

[diagram: frequency axis with vertical spectral lines. Axis labels, left to right:
-2πf_2/160, -π, -2π/5, 2π/5, π, 2πf_2/160. Curved arrow labeled "Aliasing"
from the left-side -2π/5 line wrapping toward the right-side 2π/5 line.
Spectral labels include e^{jπ/2}, 2e^{-jπ/6}, 1/2 e^{jπ/2}, -2e^{jπ/6},
2e^{jπ/6}.]

ω̃_1 = 2π 32/160 = 2π/5  ✓

ω̃_2 = 2π f_2/160 = ?

cos(1)   2πf_2/160 + 2πk = 2π/5

X[n] = e^{jπ/2}(2e^{-jπ/6} + 1/2 e^{-jπ/2})
     = e^{jπ/2} * e^{-jπ/6}(2 + 1/2)
     = e^{j2π/6} * 5/2

∴ X[n] = 5/2 cos(2π/5 n - π/6)  which is not our sampled signal.

for k = 1

2πf_2/160 - 2π = 2π/5
2πf_2 = 160π - 32π
f_2 = 128 Hz   ✓

for k = 2

2πf_2/160 - 4π = 2π/5
2πf_2 - 320π = 32π
f_2 = 352 Hz   X (not in inter

[Truncated for analysis]

### Key points

- The problem uses $f_s=160$ Hz and unknown $f_2$ with $32<f_2<200$
- The known 32 Hz sinusoid maps to $\tilde{\omega}_1=2\pi/5$
- The observed sequence is $x[n]=3\cos(2\pi n/5+\pi/2)$
- Two continuous cosines can sample to one discrete cosine if their frequencies alias to the same principal frequency
- The non-folded alias trial gives a mismatched phase and amplitude combination
- The folded alias trial matches the observed discrete-time cosine
- Solving $-2\pi f_2/160+2\pi=2\pi/5$ gives $f_2=128$ Hz
- Other candidates such as $352$ Hz and $288$ Hz are rejected because they are outside the interval

### Related topics

- [[folding-due-to-under-sampling|Folding Due to Under-Sampling]]
- [[discrete-time-aliases-and-principal-frequency|Discrete-Time Aliases and Principal Frequency]]
- [[phasor-addition-of-same-frequency-cosines|Phasor Addition of Same-Frequency Cosines]]

### Relationships

- applies-to: [[folding-due-to-under-sampling|Folding Due to Under-Sampling]]
- depends-on: [[phasor-addition-of-same-frequency-cosines|Phasor Addition of Same-Frequency Cosines]]
