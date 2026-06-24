---
title: "Natural Sampling in Pulse Amplitude Modulation"
date: "2026-04-25T10:25:58.869Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "communications-1-coursereader"
source_file: "Communications_1_CourseReader.pdf"
locations: ["Page 35"]
related: ["spectrum-of-natural-sampling-and-duty-cycle-weighting", "sampling-methods-motivation-and-learning-goals", "flat-top-sampling-and-aperture-effect"]
tags: ["natural-sampling", "gating", "pulse-amplitude-modulation", "duty-cycle", "rectangular-pulses", "analog-switch"]
source_images: ["/communication-1/assets/communications-1-coursereader-page-035-2.png"]
---

## Natural Sampling in Pulse Amplitude Modulation

Source: [[communications-1-coursereader|Communications 1 Course Reader - Sampling, PAM, PCM, and Noise]]

Locations: Page 35

Natural sampling, also called gating, is described as allowing an analog signal $a(t)$ to pass through a circuit for a finite duration $\tau$ during each sampling period $T_s$, and blocking it otherwise. The result is a pulse-amplitude-modulated waveform whose pulse tops follow the analog signal during the open-switch interval rather than being held at a constant level. Mathematically, the text models this as multiplication of the input signal by a periodic train of unit-amplitude rectangular pulses $x_g(t)$. The duty cycle is defined as $d = \tau/T_s$. Implementation is linked to a bilateral analog switch driven by a clock source. This method is practical because it only requires periodic gating of the analog signal, but unlike ideal impulse sampling, it introduces a finite pulse width that affects the spectrum. Natural sampling therefore preserves the local analog variation within each pulse while creating repeated spectral images weighted by the sampling pulse train. It stands as a realizable approximation of ideal sampling, especially useful for understanding how finite-width sampling alters spectral content.

### Source snapshots

![Communications_1_CourseReader Page 35](/communication-1/assets/communications-1-coursereader-page-035-2.png)

### Page-grounded details

#### Page 35

4.3 Gating (natural sampling)
Natural sampling is a method, which can be best described, where an analog signal a(t) is
allowed to pass through through a circuit for a certain amount of time τ , followed by period
where the signal is blocked. This sequence repeats itself periodically as can be seen in Fig.
21. Mathematically it is equivalent to multiplying the original signal a(t) with a train of
unit-amplitude rectangular sampling pulses xg(t).
x 	=
t
t
t
τ
Ts
τ
Ts
Figure 21: A input signal a(t) being multiplied by a finite width impulses xg (t), to generate output
signal sg (t), illustrating the concept of gating (natural sampling)
This type of sampling can be achieved by a switch and a clock source with duty cycle d = τ
Ts
and sampling period Ts. (See Fig. 22)
Analog bilateral switch
Clock
Figure 22: Generation of a sampled waveform using natural sampling (gating). [2, ch.3-2, p.167]
4.3.1 Spectrum of natural sampling
Firstly, let us analyze the spectrum of the finite-width impulses xg(t). Since xg(t) is a
periodic signal, we can apply the Fourier series. xg(t) can be then expressed as
xg(t) =
∞	X
k=-∞
Π( t - kTs
τ ) (46)
31

### Key points

- Natural sampling passes the analog signal only during pulse openings of width $\tau$.
- The process repeats with sampling period $T_s$.
- The sampled waveform is obtained by multiplying $a(t)$ by a rectangular pulse train $x_g(t)$.
- The duty cycle is $d = \tau/T_s$.
- A switch and a clock source can implement natural sampling.
- Pulse amplitudes vary during the open interval, unlike flat-top sampling.

### Related topics

- [[spectrum-of-natural-sampling-and-duty-cycle-weighting|Spectrum of Natural Sampling and Duty-Cycle Weighting]]
- [[sampling-methods-motivation-and-learning-goals|Sampling Methods Motivation and Learning Goals]]
- [[flat-top-sampling-and-aperture-effect|Flat-Top Sampling and Aperture Effect]]

### Relationships

- depends-on: [[spectrum-of-natural-sampling-and-duty-cycle-weighting|Spectrum of Natural Sampling and Duty-Cycle Weighting]]
- contrasts-with: [[flat-top-sampling-and-aperture-effect|Flat-Top Sampling and Aperture Effect]]
