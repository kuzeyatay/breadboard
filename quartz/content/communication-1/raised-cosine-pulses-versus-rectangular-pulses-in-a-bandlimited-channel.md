---
title: "Raised-cosine pulses versus rectangular pulses in a bandlimited channel"
date: "2026-04-25T10:25:58.869Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "communications-1-coursereader"
source_file: "Communications_1_CourseReader.pdf"
locations: ["Page 93", "Page 94", "Page 95"]
related: ["raised-cosine-nyquist-filtering", "inter-symbol-interference-from-bandwidth-limited-channels", "rz-and-manchester-line-code-spectral-properties"]
tags: ["raised-cosine-filter", "rectangular-pulse", "unipolar-rz", "isi", "bandlimited-channel"]
source_images: ["/communication-1/assets/communications-1-coursereader-page-093-2.png", "/communication-1/assets/communications-1-coursereader-page-094-2.png"]
---

## Raised-cosine pulses versus rectangular pulses in a bandlimited channel

Source: [[communications-1-coursereader|Communications 1 Course Reader - Sampling, PAM, PCM, and Noise]]

Locations: Page 93, Page 94, Page 95

The text gives a concrete comparison between rectangular and raised-cosine pulse shaping in the same bandlimited channel. A square or rectangular pulse contains frequency components beyond the channel cutoff, so the channel attenuates those components and the pulse spreads, oscillates, and interferes with adjacent symbols. In the example, the binary sequence for the letter 'N', $01001110$, is sent at 1 Mbps using unipolar RZ with about 50% duty cycle. When rectangular pulses are used, the received waveform is so distorted by ISI that it no longer resembles Unipolar RZ and instead appears closer to Unipolar NRZ, which can cause a receiver tuned for RZ to decode incorrectly. When the same data and line code are transmitted through the same channel using raised-cosine pulses with rolloff $r = 0.75$, the received waveform better preserves the intended symbol values of 1 and 0 at the sampling instants. This example shows the practical value of pulse shaping: it matches the signal to the channel rather than relying on an unrealistic ideal pulse.

### Source snapshots

![Communications_1_CourseReader Page 93](/communication-1/assets/communications-1-coursereader-page-093-2.png)

![Communications_1_CourseReader Page 94](/communication-1/assets/communications-1-coursereader-page-094-2.png)

### Page-grounded details

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

#### Page 94

-0.2
0
0.2
0.4
0.6
0.8
1
(a) Rectengular pulse
-0.2
0
0.2
0.4
0.6
0.8
1 	Received
Transmitted
 (b) Raised-cosine filtered pulse (r=0.75)
Figure 69: Figure demonstrating a rectangular pulse (a) and a raised-cosine filtered pulse (b) being
sent through bandlimited channel. It can be noticed that a rectangular pulse spreads and interferes
with adjacent timeslot (causing ISI), while a raised-cosine pulse almost doesn't spread at all, since
it exactly fits the channels bandwidth. (note that amplitude attenuation is neglected )
Now to further observe the effects intuitevely, suppose we want to transmit the letter 'N'
through this channel (in binary 01001110) at a rate of 1 Mbps. We choose to transmit using
unipolar-rz (URZ) with about 50% duty cycle line coding. The transmitted waveform can be
observed in Fig. 70. Once this waveform passes through the channel, the received waveform
at the receiving side is shown in Fig. 71. You may observe that the received waveform is
completely distorted by ISI, in which the waveform does not look anymore like a unipolar-rz
but rather like a unipolar-nrz, and if the receiver is tuned to decode unipolar-rz, the data
may be completely corrupted.
0 	1 	0

[Truncated for analysis]

#### Page 95

0 	1 	0 	0 	1 	1 	1 	0
Timeslot
1us
Time [us]
Figure 71: Received pulse sequence using rectangular pulses, with unipolar-rz line coding. It can be
observed that due to ISI the pulses almost look like unipolar-nrz instead of unipolar-rz, which will
cause corruption of data in the receiver side.
However, now we transmit the same data using the same line coding on the same channel,
however, now we use raised-cosine pules (with r=0.75) instead of rectangular pulses. The
received waveform is shown in Fig. 72. As can be observed, the raised cosine pulses much
better represent the transmitted symbols in Fig. 70, and they have a value of 1 and 0 at
the respective sampling times. The receiver, can then easily decode the data, at a rate of
1Mbps through this bandlimited channel.
0 	1 	0 	0 	1 	1 	1 	0
Timeslot
1us
Time [us]
Figure 72: Received raised-cosine filtered pulse sequence, with unipolar-rz line coding. It can be
observed that raised-cosine pulses do not get affected by the bandlimited channel, and they have a
amplitude of 1, and 0 at their sampling instances, preserving the shape of unipolar-rz line coding
91

### Key points

- Rectangular pulses spread strongly in a bandlimited channel.
- Pulse spreading causes ISI and can change the apparent line-code shape.
- The example transmits 01001110 at 1 Mbps using Unipolar RZ with roughly 50% duty cycle.
- With rectangular pulses, the received signal resembles Unipolar NRZ rather than Unipolar RZ.
- Raised-cosine pulses with $r = 0.75$ preserve correct sampling values much better.
- Pulse shaping enables reliable decoding in the same channel where unshaped pulses fail.

### Related topics

- [[raised-cosine-nyquist-filtering|Raised-cosine Nyquist filtering]]
- [[inter-symbol-interference-from-bandwidth-limited-channels|Inter-symbol interference from bandwidth-limited channels]]
- [[rz-and-manchester-line-code-spectral-properties|RZ and Manchester line-code spectral properties]]

### Relationships

- example-of: [[inter-symbol-interference-from-bandwidth-limited-channels|Inter-symbol interference from bandwidth-limited channels]]
- applies-to: [[rz-and-manchester-line-code-spectral-properties|RZ and Manchester line-code spectral properties]]
