---
title: "Raised-cosine Nyquist filtering"
date: "2026-04-25T10:25:58.869Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "communications-1-coursereader"
source_file: "Communications_1_CourseReader.pdf"
locations: ["Page 92", "Page 93"]
related: ["nyquist-zero-isi-criterion-and-ideal-sinc-pulses", "inter-symbol-interference-from-bandwidth-limited-channels", "mini-lab-8-2-raised-cosine-filtering-procedure", "raised-cosine-pulses-versus-rectangular-pulses-in-a-bandlimited-channel"]
tags: ["raised-cosine-filter", "rolloff-factor", "nyquist-filter", "bandwidth", "isi", "lab-2"]
source_images: ["/communication-1/assets/communications-1-coursereader-page-092-2.png", "/communication-1/assets/communications-1-coursereader-page-093-2.png"]
---

## Raised-cosine Nyquist filtering

Source: [[communications-1-coursereader|Communications 1 Course Reader - Sampling, PAM, PCM, and Noise]]

Locations: Page 92, Page 93

Raised-cosine filtering is presented as the practical pulse-shaping method used to minimize ISI in real bandwidth-limited systems. Its frequency response is flat up to $f_1$, rolls off smoothly between $f_1$ and the total bandwidth $B$, and is zero outside that range. The text defines the key parameters $$f_\Delta = B - f_0, \quad f_1 = f_0 - f_\Delta, \quad r = \frac{f_\Delta}{f_0}, \quad B = f_0(1+r),$$ where $f_0$ is the 6-dB bandwidth and $r$ is the rolloff factor. When $r=0$, the filter becomes an ideal rectangular filter; larger $r$ values widen the bandwidth but improve time-domain concentration and reduce ISI sensitivity. The time-domain pulse is given by $$h_e(t) = 2f_0\,\mathrm{sinc}(2f_0 t)\left[\frac{\cos(2\pi f_\Delta t)}{1-(4f_\Delta t)^2}\right],$$ and the maximum zero-ISI symbol rate is $$D_{\max}=2f_0.$$ The chapter uses visual examples to show that raised-cosine-filtered pulses fit a bandlimited channel much better than raw rectangular pulses, yielding received waveforms that preserve symbol values at their sampling instants.

### Source snapshots

![Communications_1_CourseReader Page 92](/communication-1/assets/communications-1-coursereader-page-092-2.png)

![Communications_1_CourseReader Page 93](/communication-1/assets/communications-1-coursereader-page-093-2.png)

### Page-grounded details

#### Page 92

8.6 Raised cosine-rolloff Nyquist filtering
Raised cosine-rolloff Nyquist filtering is used to generate pulses that minimize ISI. The
transfer function of such a filter is
He(f ) =

	
	
1 for |f | <= f1
1
2 [1 + cos( π(|f |-f1)
2f∆ )] for f1 < |f | < B
0 for |f | >= B
(108)
The transfer function spectrum is plotted in Fig. 65
- B 	B	- f0 	f0	- f1 	f1
f 	f
|H e(f ) |
1.0
0.5
f
Figure 65: Raised cosine-rolloff Nyquist filter characteristics. [2, ch.3.6, p.211, fig. 3-25]
B is the absolute bandwidth with the parameters
f∆ = B - f0 (109)
and
f1 = f0 - f∆ (110)
where f0 is called the 6-dB bandwidth of the filter. Furthermore, we define the rolloff factor
to be
r = f∆
f0
(111)
Which is the steepness of the filter. For r = 0, the filter is an ideal rectangular filter.
Furthermore, bandwidth can also be defined as
B = f0(1 + r) (112)
The envelope of the filter decays with a factor of 1
t3
- 2 f0 	- f0 	0.5 f0 	1.5 f0
r= 0
r= 0.5
r= 1.0
f0 	2 f0
|H e(f ) |
0.5
1.0
Figure 66: Raised cosine-rolloff Nyquist filter magnitude frequency response by varying r [2, ch.3,
p.212 (3-26)]
88

#### Page 93

f0
he(t )
t
r= 1.0
r= 0.5
r= 0	1/2f0
2f0
f0
---	-2
f0
---2
2f0
---	-5
2f0
---5
f0
---	-3
f0
---3
2f0
---	-3
2f0
---3
f0
---	-1
f0
---1
2f0
---	-1
2f0
Ts
---1	0
Figure 67: Impulse response he(t) of the raised cosine filter with varying r [2, ch.3, p.212 (3-26)]
Such a filter is obtained by convolving a band-limited cosine and a rectangular specturm
filter (visualized in Fig. 68)
He(f ) = Π( f
2f0
) ∗ (cos( πf
2f∆
) * Π( f
2f∆
)) (113)
Figure 68: Convolution between a bandlimited cosine spectrum and a rectangular spectrum
By taking the inverse Fourier transform we can get the time-domain equation of raised-
cosine pulses
he(t) = F -1[He(f )] = 2f0sinc(2f0t)
h cos(2πf∆t)
1 - (4f∆t)2
i
(114)
The symbol period of a raised cosine is 1
2 f0. Where the maximum symbol rate for no ISI
is
Dmax = 2f0 (115)
To intuitively demonstrate the necessity of raised-cosine filtering, consider a bandlimited
channel (e.g., a long CAT-1 twisted-pair wire) with a maximum frequency range up to fcut.
When sending a square pulse with a bandwidth exceeding the channel's maximum rated
bandwidth, higher frequency components are attenuated, causing pulse spreading, interfer-
ing in adjacent time slots and oscillat

[Truncated for analysis]

### Key points

- Raised-cosine filtering is used to generate pulses that minimize ISI.
- The transfer function has a flat region, cosine rolloff region, and zero region.
- The rolloff factor is $r = f_\Delta/f_0$.
- Total bandwidth is $B = f_0(1+r)$.
- The inverse Fourier transform gives the time-domain raised-cosine pulse.
- The maximum no-ISI symbol rate is $D_{\max} = 2f_0$.
- Larger rolloff generally increases bandwidth but improves practical pulse behavior.

### Related topics

- [[nyquist-zero-isi-criterion-and-ideal-sinc-pulses|Nyquist zero-ISI criterion and ideal sinc pulses]]
- [[inter-symbol-interference-from-bandwidth-limited-channels|Inter-symbol interference from bandwidth-limited channels]]
- [[mini-lab-8-2-raised-cosine-filtering-procedure|Mini-lab 8.2 raised-cosine filtering procedure]]
- [[raised-cosine-pulses-versus-rectangular-pulses-in-a-bandlimited-channel|Raised-cosine pulses versus rectangular pulses in a bandlimited channel]]

### Relationships

- applies-to: [[raised-cosine-pulses-versus-rectangular-pulses-in-a-bandlimited-channel|Raised-cosine pulses versus rectangular pulses in a bandlimited channel]]
- applies-to: [[mini-lab-8-2-raised-cosine-filtering-procedure|Mini-lab 8.2 raised-cosine filtering procedure]]

## Added from [[topicmap|Communications 1 (5ETC0) Topic Map]]

Source label: Topic map for the full course

Locations: Page 1

The raised-cosine filter appears in the topic map near the ISI label, indicating that it is a course concept connected to intersymbol interference. Although the source does not provide the filter formula or frequency response, its placement next to ISI and the channel impairment diagram suggests that the filter is studied as part of controlling signal spreading or symbol interference in communication systems. The raised-cosine filter is grouped near a diagram where a signal passes through ISI plus noise and becomes a noisy signal. This context makes it a physical-layer waveform-shaping or filtering concept rather than an encoding concept. The map associates this area with topic letters F,J,K, tying it to channel effects and possibly later modulation or transmission topics.

### Source snapshots

![TopicMap Page 1](/communication-1/assets/topicmap-page-001.png)

### New key points

- The source explicitly names "Raised-cosine filter."
- It appears adjacent to the label "ISI."
- It is located near the diagram showing "ISI + Noise."
- The map connects it to physical-channel signal quality rather than message formatting.
- No formula is provided in the source.
- The topic area is associated with letters F,J,K.
