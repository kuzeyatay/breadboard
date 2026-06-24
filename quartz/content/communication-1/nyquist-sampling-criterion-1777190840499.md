---
title: "Nyquist Sampling Criterion"
date: "2026-04-26T08:07:20.499Z"
source: "generated-chat"
knowledge_type: "generated-note"
generated_by: "chatmock"
related: ["sampling-theory-1777190840499", "aliasing-and-nyquist-sampling-criterion", "fourier-analysis-of-signals-1777190840499", "spectral-replication-from-sampling", "raised-cosine-nyquist-filtering", "ideal-sampling-as-multiplication-by-a-delta-train"]
tags: ["nyquist-criterion", "nyquist-rate", "aliasing", "bandwidth", "audio-sampling", "sampling", "mathrm-khz", "nyquist-sampling"]
---

## Nyquist Sampling Criterion

The **Nyquist sampling criterion** states that a bandlimited signal with maximum frequency $B$ must be sampled at least twice that frequency to avoid aliasing:

$$
f_s \ge 2B
$$

The quantity $2B$ is called the **Nyquist rate**. This condition prevents the repeated spectral copies created by sampling from overlapping in the frequency domain. If the copies remain separated, an ideal **low-pass filter** can select the original baseband spectrum and reject the replicas centered at $\pm f_s$, $\pm 2f_s$, and so on.

The time-domain intuition is that the fastest sinusoidal component must be sampled at least twice per cycle. For example, if the highest frequency is $100\,\mathrm{Hz}$, its period is:

$$
T = \frac{1}{100\,\mathrm{Hz}} = 10\,\mathrm{ms}
$$

The sampling rate must be at least $200\,\mathrm{Hz}$. Sampling below this rate causes high-frequency content to appear as lower-frequency content, a phenomenon called **aliasing**.

Audio sampling illustrates the criterion: human hearing extends roughly to $20\,\mathrm{kHz}$, so common rates such as $44.1\,\mathrm{kHz}$ and $48\,\mathrm{kHz}$ exceed twice that bandwidth. The criterion is a central result of [[Sampling Theory]] and depends on [[Fourier Analysis of Signals]].

## Related notes

- [[sampling-theory-1777190840499|Sampling Theory]]
- [[aliasing-and-nyquist-sampling-criterion|Aliasing and Nyquist Sampling Criterion]]
- [[fourier-analysis-of-signals-1777190840499|Fourier Analysis of Signals]]
- [[spectral-replication-from-sampling|Spectral Replication from Sampling]]
- [[raised-cosine-nyquist-filtering|Raised-cosine Nyquist filtering]]
- [[ideal-sampling-as-multiplication-by-a-delta-train|Ideal Sampling as Multiplication by a Delta Train]]
