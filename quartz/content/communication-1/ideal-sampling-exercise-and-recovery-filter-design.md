---
title: "Ideal Sampling Exercise and Recovery Filter Design"
date: "2026-04-25T10:25:58.869Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "communications-1-coursereader"
source_file: "Communications_1_CourseReader.pdf"
locations: ["Page 33"]
related: ["aliasing-and-nyquist-sampling-criterion", "natural-sampling-in-pulse-amplitude-modulation", "flat-top-sampling-and-aperture-effect"]
tags: ["ideal-sampling", "sampling-interval", "recovery-filter", "rectangular-spectrum", "sampling-theorem", "week-2", "week-3"]
source_images: ["/communication-1/assets/communications-1-coursereader-page-033-2.png"]
---

## Ideal Sampling Exercise and Recovery Filter Design

Source: [[communications-1-coursereader|Communications 1 Course Reader - Sampling, PAM, PCM, and Noise]]

Locations: Page 33

The instruction exercise on sampling theory asks the learner to apply ideal impulse sampling results to an analog waveform with a rectangular spectrum and maximum frequency $B = 10\text{ MHz}$. The task is to determine the maximum sampling interval $T_s$ that still allows exact reconstruction, sketch the sampled spectrum for a specific value of $T_s = 20\text{ ns}$, and identify the impulse response of the ideal recovery filter. Although the worked solution is not included in this chunk, the exercise reflects the durable procedure implied by earlier theory: first apply the Nyquist condition to constrain $T_s$, then use the impulse-sampling spectrum as repeated shifted copies of the original spectrum spaced by $f_s = 1/T_s$, and finally choose an ideal low-pass reconstruction filter matched to the original signal bandwidth. The significance of this exercise is that it ties together time-domain sampling interval, frequency-domain spectral replication, and the recovery filter required for exact reconstruction. It therefore serves as a compact design template for ideal sampling problems.

### Source snapshots

![Communications_1_CourseReader Page 33](/communication-1/assets/communications-1-coursereader-page-033-2.png)

### Page-grounded details

#### Page 33

3.6 Instruction Exercises - Sampling Theory
The solutions to these exercises may be found under the page 5ETC0 Canvas Page Mod-
ules -> Week 1 -> B. Sampling Theorem (Ideal sampling case) and Dimension-
ality Theorem
Exercise 1) (Video solution available) An arbitrary waveform w(t) with a rectan-
gular spectrum with the highest-frequency B = 10 MHz is sampled with ideal impulses
with sampling interval Ts ("impulse sampling"). The resulting sampled signal is ws(t) =
w(t) P∞
n=-∞ δ(t - nTs)
- a) What is the maximum value of Ts with which an exact reconstruction of w(t) is
still possible?
- b) Sketch the spectrum of ws(t) for a value of Ts = 20 ns. Clearly show the charac-
teristic points on both axes!
- c) What is the impulse response of the ideal recovery filter?
29

### Key points

- The waveform has a rectangular spectrum with highest frequency $B = 10\text{ MHz}$.
- Exact reconstruction depends on the maximum permissible sampling interval $T_s$.
- The sampled spectrum for impulse sampling must be sketched for $T_s = 20\text{ ns}$.
- The recovery stage is modeled by an ideal reconstruction filter.
- The exercise links Nyquist sampling, spectral replication, and ideal filtering.

### Related topics

- [[aliasing-and-nyquist-sampling-criterion|Aliasing and Nyquist Sampling Criterion]]
- [[natural-sampling-in-pulse-amplitude-modulation|Natural Sampling in Pulse Amplitude Modulation]]
- [[flat-top-sampling-and-aperture-effect|Flat-Top Sampling and Aperture Effect]]

### Relationships

- applies-to: [[aliasing-and-nyquist-sampling-criterion|Aliasing and Nyquist Sampling Criterion]]
