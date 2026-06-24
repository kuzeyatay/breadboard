---
title: "Amplitude Modulation Fundamentals"
date: "2026-04-25T10:25:58.869Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "communications-1-coursereader"
source_file: "Communications_1_CourseReader.pdf"
locations: ["Page 113"]
related: ["am-modulation-percentage-efficiency-and-peak-envelope-power", "spectrum-of-conventional-am", "envelope-detector-for-am-demodulation"]
tags: ["amplitude-modulation", "envelope", "carrier-amplitude", "message-signal"]
source_images: ["/communication-1/assets/communications-1-coursereader-page-113-2.png"]
---

## Amplitude Modulation Fundamentals

Source: [[communications-1-coursereader|Communications 1 Course Reader - Sampling, PAM, PCM, and Noise]]

Locations: Page 113

Amplitude modulation (AM) encodes information by varying the amplitude of a high-frequency carrier in proportion to a lower-frequency message signal $m(t)$. The chapter defines the envelope as $g(t)=A_c[1+m(t)]$ and the transmitted AM waveform as $s(t)=g(t)\cos(\omega_c t)$. In this formulation, the message influences the time-varying envelope while the carrier provides the oscillation at the passband frequency. The chapter uses a sinusoidal message to illustrate how the modulated waveform expands and contracts between maximum and minimum amplitudes. These extrema are $A_c(1+\max[m(t)])$ and $A_c(1+\min[m(t)])$, denoted $A_{\max}$ and $A_{\min}$. This representation supports later definitions of modulation percentage, efficiency, and peak envelope power. AM is highlighted as one of the simplest analog modulation schemes and can also serve digital modulation purposes in some contexts. Its conceptual simplicity makes it a useful starting point for understanding more power-efficient or noise-robust alternatives.

### Source snapshots

![Communications_1_CourseReader Page 113](/communication-1/assets/communications-1-coursereader-page-113-2.png)

### Page-grounded details

#### Page 113

10.4 Amplitude Modulation (AM)
Amplitude Modulation (AM) is one of the simplest modulation schemes used in analog
communications, but can also be used to modulate digital signals. In AM, the amplitude
of a high-frequency carrier signal is varied in proportion to a lower-frequency baseband
message signal m(t). Essentially, the message (e.g. music) waveform is encoded on the
high-frequency carrier's signal amplitude
(a) Sinusoidal modulating wave (Message)
(b) Resulting AM signal to be transmitted
s(t)
m(t)
Amin
Amax
AC
AC [1+m(t)]
t
t
Figure 80: Typical AM Waveform, where m(t) is a low-frequency sine wave.
With the notations:
- g(t), the envelope of the signal (dashed line on Fig. 80b)
- Ac, the carrier amplitude
- m(t), the modulating signal (essentially the message we want to transmit)
- s(t), the AM signal
The equations for the transmitted signal are defined as:
g(t) = Ac[1 + m(t)] (130)
s(t) = g(t) cos(ωct) (131)
You may observe how exactly the modulating signal affects the amplitude of the waveform
at any given moment. It then follows that the maximum value that the modulated signal
will reach, is equal to Ac (1 + max[m(t)]), and the minimal value Ac (1 + min[m(t)]). Hence
we d

[Truncated for analysis]

### Key points

- AM varies carrier amplitude according to the message signal.
- The envelope is $g(t) = A_c[1+m(t)]$.
- The transmitted AM signal is $s(t) = g(t)\cos(\omega_c t)$.
- The message is contained in the waveform envelope.
- The maximum envelope value is $A_c(1+\max[m(t)])$.
- The minimum envelope value is $A_c(1+\min[m(t)])$.
- AM uses a carrier plus sidebands.

### Related topics

- [[am-modulation-percentage-efficiency-and-peak-envelope-power|AM Modulation Percentage, Efficiency, and Peak Envelope Power]]
- [[spectrum-of-conventional-am|Spectrum of Conventional AM]]
- [[envelope-detector-for-am-demodulation|Envelope Detector for AM Demodulation]]

### Relationships

- depends-on: [[am-modulation-percentage-efficiency-and-peak-envelope-power|AM Modulation Percentage, Efficiency, and Peak Envelope Power]]
