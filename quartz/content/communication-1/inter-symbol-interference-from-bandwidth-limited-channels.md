---
title: "Inter-symbol interference from bandwidth-limited channels"
date: "2026-04-25T10:25:58.869Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "communications-1-coursereader"
source_file: "Communications_1_CourseReader.pdf"
locations: ["Page 86", "Page 87", "Page 88"]
related: ["modelling-isi-in-a-baseband-pulse-transmission-system", "nyquist-zero-isi-criterion-and-ideal-sinc-pulses", "raised-cosine-nyquist-filtering"]
tags: ["inter-symbol-interference", "bandwidth-limited-channel", "rectangular-pulses", "channel-passband", "isi", "lab-2"]
source_images: ["/communication-1/assets/communications-1-coursereader-page-086-2.png", "/communication-1/assets/communications-1-coursereader-page-087-2.png"]
---

## Inter-symbol interference from bandwidth-limited channels

Source: [[communications-1-coursereader|Communications 1 Course Reader - Sampling, PAM, PCM, and Noise]]

Locations: Page 86, Page 87, Page 88

Inter-symbol interference arises because practical channels are bandwidth-limited, while common digital pulses such as rectangular waveforms contain high-frequency components extending far beyond that limit. When these components are attenuated by the channel, the pulse shape becomes smoother and spreads in time. A pulse that should occupy only one symbol interval then leaks into neighboring intervals, altering the received amplitude at the sampling instants for adjacent symbols. This smearing can corrupt decisions and therefore limits transmission reliability and data rate. The chapter emphasizes that ISI is unavoidable in practical systems and must be understood and managed. A mini-lab visualizes the effect by lowering the channel passband frequency step by step and plotting the received waveform while overlaying the transmitted signal. As the passband shrinks, the distortion becomes more obvious, making ISI visible as overlap between neighboring symbols.

### Source snapshots

![Communications_1_CourseReader Page 86](/communication-1/assets/communications-1-coursereader-page-086-2.png)

![Communications_1_CourseReader Page 87](/communication-1/assets/communications-1-coursereader-page-087-2.png)

### Page-grounded details

#### Page 86

8 Inter-symbol interference
8.1 Learning objectives
Students completing this chapter should have learned:
1. Understand that bandwidth limited channels will introduce signal distortions leading
to inter symbol interference (ISI).
2. Can calculate the spectral efficiency and bandwidth requirement for using raised-cosine
with a roll off factor r.
3. Understand why Sinc pulses offer the highest D/B ratio due to symbol overlap.
8.2 Motivation
In practical communication systems, the presence of 'Inter-Symbol Interference' (ISI) is
an unavoidable phenomenon. ISI is inherently undesirable due to its potential to distort
transmitted waveforms, introduce errors at the receiver, and impose limitations on transmis-
sion rates; therefore, its study is of paramount importance. Understanding and effectively
managing this phenomenon becomes crucial for enhancing the reliability and efficiency of
telecommunication systems.
PHYSICAL CHANNEL
(wired or wireless)
Raised-cosine filter 	ISI
+
Noise
Signal
Noisy
signal
Figure 59: Topic map location
82

#### Page 87

8.3 What is inter-symbol interference?
As we have seen previously, the absolute bandwidth of rectangular pulses is infinite. How-
ever, in every channel, there are bandwidth limitations, either imposed specifically (such as
in wireless systems, where you can only use a certain amount of bandwidth) or the channel
itself will act as a filter limiting the bandwidth. Filtering causes frequency components to
be attenuated, which then in the time domain means the rectangular pulse will be less rect-
angular and more smoothed (hence spreading, supposing the filter is filtering high-frequency
components). These bandwidth limitations will cause the pulses to spread in time, and the
pulse for each symbol may be smeared into adjacent time slots, which can corrupt the infor-
mation being carried in the pulse on the adjacent timeslot, by altering its actual amplitude
and hence, cause ISI on the receiver. The concept of ISI is visualized in Fig. 60
Figure 60: The concept of ISI visualized, for an individual rectangular pulse, and a stream of
rectangular pulses. [2, ch. 3-6, p. 207]
83

#### Page 88

Minilab exercise 8.1 - ISI Visualization
This mini-lab exercise requires you to use Mini-lab 4 - ISI (Intersymbol interference)
When you open Minilab 4 you will be confronted with the following view:
- 1) Leave the default settings and click on upload input to transmit the signal
through the channel.
- 2) Click on 'Plot channel output' to see the received signal
- 3) Firstly, make sure to check the box 'overlay transmitted signal ', which
helps you compare how the signal was transmitted and how it was received on
the bottom-left plot. Now, decrease the channel passband frequency to 5000
Hz from 20000 Hz, in steps of 5000 Hz. Every time you decrease it, please
click on 'plot channel output' to see the effects. Can you notice intersymbol
interference occurring? [overlay,ancho
84

### Key points

- Rectangular pulses have infinite absolute bandwidth.
- Real channels impose bandwidth limitations or act as filters.
- Filtering attenuates high-frequency components and smooths pulses in time.
- Pulse spreading makes one symbol interfere with adjacent symbol intervals.
- ISI introduces receiver errors and limits transmission rates.
- The mini-lab demonstrates stronger ISI as channel passband is reduced.

### Related topics

- [[modelling-isi-in-a-baseband-pulse-transmission-system|Modelling ISI in a baseband pulse transmission system]]
- [[nyquist-zero-isi-criterion-and-ideal-sinc-pulses|Nyquist zero-ISI criterion and ideal sinc pulses]]
- [[raised-cosine-nyquist-filtering|Raised-cosine Nyquist filtering]]

### Relationships

- depends-on: [[modelling-isi-in-a-baseband-pulse-transmission-system|Modelling ISI in a baseband pulse transmission system]]
- enables: [[raised-cosine-nyquist-filtering|Raised-cosine Nyquist filtering]]
