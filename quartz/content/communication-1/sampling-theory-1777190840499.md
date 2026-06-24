---
title: "Sampling Theory"
date: "2026-04-26T08:07:20.499Z"
source: "generated-chat"
knowledge_type: "generated-note"
generated_by: "chatmock"
related: ["fourier-analysis-of-signals-1777190840499", "digital-communication-chain-1777190840499", "spectral-replication-from-sampling", "aliasing-and-nyquist-sampling-criterion", "ideal-sampling-as-multiplication-by-a-delta-train", "sampling-as-the-first-step-of-digitization"]
tags: ["sampling", "aliasing", "impulse-train", "bandlimited-signal", "sum-infty", "infty", "frequency", "infty-delta"]
---

## Sampling Theory

**Sampling** converts a continuous-time signal into values at discrete time instants. If the original signal is $x(t)$ and samples are taken every $T_s$ seconds, the sampling frequency is:

$$
f_s = \frac{1}{T_s}
$$

The samples are $x(nT_s)$ for integer $n$. An ideal mathematical model uses an impulse train:

$$
p(t)=\sum_{n=-\infty}^{\infty}\delta(t-nT_s)
$$

The sampled signal is:

$$
x_s(t)=x(t)p(t)=\sum_{n=-\infty}^{\infty}x(nT_s)\delta(t-nT_s)
$$

This model shows that sampling is not merely “taking dots.” In the frequency domain, sampling creates repeated copies of the original spectrum:

$$
X_s(f)=f_s\sum_{k=-\infty}^{\infty}X(f-kf_s)
$$

If these spectral copies overlap, **aliasing** occurs. Aliasing means different frequency components become indistinguishable, causing irreversible loss of information.

Sampling is therefore governed by bandwidth. A **bandlimited signal** with no content above frequency $B$ can be reconstructed only if the sampling frequency is high enough. This connects sampling directly to [[Fourier Analysis of Signals]], [[Nyquist Sampling Criterion]], and the broader [[Digital Communication Chain]].

## Related notes

- [[fourier-analysis-of-signals-1777190840499|Fourier Analysis of Signals]]
- [[digital-communication-chain-1777190840499|Digital Communication Chain]]
- [[spectral-replication-from-sampling|Spectral Replication from Sampling]]
- [[aliasing-and-nyquist-sampling-criterion|Aliasing and Nyquist Sampling Criterion]]
- [[ideal-sampling-as-multiplication-by-a-delta-train|Ideal Sampling as Multiplication by a Delta Train]]
- [[sampling-as-the-first-step-of-digitization|Sampling as the First Step of Digitization]]
