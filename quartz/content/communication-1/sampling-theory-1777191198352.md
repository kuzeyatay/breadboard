---
title: "Sampling Theory"
date: "2026-04-26T08:13:18.352Z"
source: "generated-chat"
knowledge_type: "generated-note"
generated_by: "chatmock"
related: ["nyquist-sampling-criterion-1777190840499", "sampling-theory-1777190840499", "digital-communication-chain-1777190840499", "signal-reconstruction-with-dac-and-lpf", "fourier-analysis-of-signals-1777190840499", "fourier-analysis-of-signals-1777191198352"]
tags: ["nyquist-rate", "aliasing", "band-limited-signals", "impulse-train", "signal-reconstruction", "mathrm-khz", "sampling", "sampling-theory"]
---

## Sampling Theory

**Sampling theory** explains when a continuous-time signal can be represented by discrete-time samples without losing information. If $x(t)$ is sampled every $T_s$ seconds, the sampling frequency is:

$$
f_s = \frac{1}{T_s}
$$

The ideal sampling model multiplies the signal by an impulse train:

$$
p(t)=\sum_{n=-\infty}^{\infty}\delta(t-nT_s)
$$

producing:

$$
x_s(t)=\sum_{n=-\infty}^{\infty}x(nT_s)\delta(t-nT_s)
$$

In the frequency domain, sampling creates repeated copies of the original spectrum spaced by $f_s$:

$$
X_s(f)=f_s\sum_{k=-\infty}^{\infty}X(f-kf_s)
$$

This result reveals the central danger: **aliasing**. If the shifted spectral copies overlap, different frequency components become indistinguishable and information is irreversibly lost.

For a band-limited signal with no components above bandwidth $B$, perfect ideal reconstruction is possible when:

$$
f_s \ge 2B
$$

This is the **Nyquist sampling criterion**. The rate $2B$ is the Nyquist rate. For example, audio with content up to roughly $20\,\mathrm{kHz}$ requires sampling above $40\,\mathrm{kHz}$, motivating rates such as $44.1\,\mathrm{kHz}$ and $48\,\mathrm{kHz}$.

Sampling connects [[Fourier Analysis of Signals]] to the [[Digital Communication Chain]] because discrete representation is only valid when bandwidth and reconstruction constraints are respected.

## Related notes

- [[nyquist-sampling-criterion-1777190840499|Nyquist Sampling Criterion]]
- [[sampling-theory-1777190840499|Sampling Theory]]
- [[digital-communication-chain-1777190840499|Digital Communication Chain]]
- [[signal-reconstruction-with-dac-and-lpf|Signal Reconstruction with DAC and LPF]]
- [[fourier-analysis-of-signals-1777190840499|Fourier Analysis of Signals]]
- [[fourier-analysis-of-signals-1777191198352|Fourier Analysis of Signals]]
