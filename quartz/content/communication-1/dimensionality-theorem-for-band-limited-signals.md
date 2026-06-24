---
title: "Dimensionality Theorem for Band-Limited Signals"
date: "2026-04-25T10:25:58.869Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "communications-1-coursereader"
source_file: "Communications_1_CourseReader.pdf"
locations: ["Page 32"]
related: ["dimensionality-theorem-worked-example", "aliasing-and-nyquist-sampling-criterion", "pcm-bandwidth-requirements"]
tags: ["dimensionality-theorem", "bandwidth", "symbols", "oversampling", "band-limited-waveform"]
source_images: ["/communication-1/assets/communications-1-coursereader-page-032-2.png"]
---

## Dimensionality Theorem for Band-Limited Signals

Source: [[communications-1-coursereader|Communications 1 Course Reader - Sampling, PAM, PCM, and Noise]]

Locations: Page 32

The dimensionality theorem gives the number of independent pieces of information needed to describe a real band-limited waveform over a finite time interval. In the text, this number is denoted by $N$ and expressed as $N = 2BT_0$, where $B$ is the signal bandwidth and $T_0$ is the observation or reconstruction interval. The theorem formalizes an important communications idea: a band-limited waveform contains only a finite number of independent degrees of freedom over a finite duration. This means that once sampling is dense enough to capture those independent dimensions, taking additional samples does not create new information because the extra points are not independent. The text connects this directly to oversampling, stating that adding more data points beyond the necessary amount does not increase the information conveyed. It also generalizes the idea from signals to communication systems: the information that can be conveyed is proportional to the product of bandwidth and time. In practice, this theorem underpins the relation between sampling theory, symbol count, and information transmission over band-limited systems.

### Source snapshots

![Communications_1_CourseReader Page 32](/communication-1/assets/communications-1-coursereader-page-032-2.png)

### Page-grounded details

#### Page 32

3.5 Dimensionality theorem
The dimensionality theorem describes the number of independent pieces of information,
which can describe a real waveform. That number N is mathematically described as




N = 2BT0 (45)
where B is the bandwidth of the waveform and T0 is the time span over which the signal is to
be described (sampled). Essentially, through the dimensionality theorem, we are connecting
the number of data points (pieces of information) to the sampling frequency and the time
interval of sampling. It tells us that we cannot get more information by adding more
points (oversampling) since then the information in these additional points is no longer
independent!
In other words, the information that can be conveyed by a band-limited waveform (with a
bandwidth B) or a band-limited communication system is proportional to the product of
the bandwidth of that signal/system and the time allowed for transmission of the informa-
tion.
Exercise 3: Dimensionality thorem
Consider a signal with a bandwidth of
B = 64 kHz,
and suppose we wish to reconstruct this signal over a duration of
T = 10 seconds.
Determine:
1. The number of symbols (independent pieces of information) required for rec

[Truncated for analysis]

### Key points

- The theorem states $N = 2BT_0$ for a real band-limited waveform.
- Here $N$ is the number of independent pieces of information.
- Bandwidth and time jointly determine how much independent information can be represented.
- Oversampling does not create new independent information.
- The conveyed information is proportional to the product of bandwidth and transmission time.

### Related topics

- [[dimensionality-theorem-worked-example|Dimensionality Theorem Worked Example]]
- [[aliasing-and-nyquist-sampling-criterion|Aliasing and Nyquist Sampling Criterion]]
- [[pcm-bandwidth-requirements|PCM Bandwidth Requirements]]

