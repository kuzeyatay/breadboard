---
title: "AM Modulation Percentage, Efficiency, and Peak Envelope Power"
date: "2026-04-25T10:25:58.869Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "communications-1-coursereader"
source_file: "Communications_1_CourseReader.pdf"
locations: ["Page 114"]
related: ["amplitude-modulation-fundamentals", "double-sideband-suppressed-carrier-modulation", "envelope-detector-for-am-demodulation"]
tags: ["percentage-of-modulation", "modulation-efficiency", "peak-envelope-power", "load-resistance"]
source_images: ["/communication-1/assets/communications-1-coursereader-page-114-2.png"]
---

## AM Modulation Percentage, Efficiency, and Peak Envelope Power

Source: [[communications-1-coursereader|Communications 1 Course Reader - Sampling, PAM, PCM, and Noise]]

Locations: Page 114

The chapter defines three quantitative measures for standard AM. The percentage of modulation expresses how strongly the carrier amplitude is varied by the message and is given by $\%\mathrm{mod}=\frac{\max(m(t)) - \min(m(t))}{2} \times 100\%$. Positive modulation percentage is $\max[m(t)]\times 100\%$, and negative modulation percentage is $-\min[m(t)]\times 100\%$. Modulation efficiency describes what fraction of transmitted power actually conveys information. Because the carrier consumes power without carrying message content, unsuppressed AM is not fully efficient; the chapter gives $\eta_{\mathrm{mod}} = \frac{\langle m^2(t)\rangle}{1+\langle m^2(t)\rangle}\times 100\%$. For a sinusoidal message, the mean-squared value is computed as $\langle m^2(t)\rangle = 1/2$. Peak envelope power (PEP) is the maximum instantaneous power associated with the envelope and is defined as $P_{\mathrm{PEP,norm}} = \frac{1}{2R}[\max(|g(t)|)]^2 = \frac{A_c^2}{2R}[1+\max(m(t))]^2$. The text notes that a load resistance, often 50 $\Omega$ in radio systems, is assumed for power calculations.

### Source snapshots

![Communications_1_CourseReader Page 114](/communication-1/assets/communications-1-coursereader-page-114-2.png)

### Page-grounded details

#### Page 114

10.4.1 Percentage of modulation
The percentage of modulation (or modulation index expressed as a percentage) quantifies
the degree to which the amplitude of a carrier is varied by the baseband message signal
m(t). Essentially, it provides a measure of how much the information signal influences the
overall amplitude of the transmitted wave. We define the percentage of modulation as




%mod = max(m(t))-min(m(t))
2 	* 100%. 	(132)
Where the percentage of positive modulation is given by max[m(t)] * 100%, and that of
negative modulation by -min[m(t)] * 100%.
10.4.2 Modulation efficiency
Modulation efficiency in AM scheme measures how effectively the transmitted power is
used to convey information. In an unsuppressed AM system, the total transmitted power
is divided between the carrier and the sidebands, but only the sidebands actually contain
the message information. The modulation efficiency ηmod is defined as

ηmod = <m2(t)>
1+<m2(t)> * 100% 	(133)
where < m2(t) > is the mean-squared value of the modulating signal m(t). For example,
for a sinusoidal signal, the mean squared-value < m2(t) > can be computed as
< m2(t) >= 1
T
Z T
0
sin2(ωt)dt = 1
T
Z T
0
( 1
2 - 1
2 cos(2ωt))dt = 1

[Truncated for analysis]

### Key points

- Percentage of modulation quantifies envelope variation relative to the carrier.
- Positive and negative modulation percentages are defined separately.
- In AM, only sidebands carry information while the carrier also consumes power.
- Modulation efficiency depends on the mean-squared value of $m(t)$.
- For a sinusoidal message, $\langle m^2(t)\rangle = 1/2$.
- Peak envelope power is the maximum power the transmitter must handle.
- PEP calculations assume a load resistance $R$.

### Related topics

- [[amplitude-modulation-fundamentals|Amplitude Modulation Fundamentals]]
- [[double-sideband-suppressed-carrier-modulation|Double-Sideband Suppressed Carrier Modulation]]
- [[envelope-detector-for-am-demodulation|Envelope Detector for AM Demodulation]]

