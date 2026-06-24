---
title: "Nyquist zero-ISI criterion and ideal sinc pulses"
date: "2026-04-25T10:25:58.869Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "communications-1-coursereader"
source_file: "Communications_1_CourseReader.pdf"
locations: ["Page 90", "Page 91"]
related: ["modelling-isi-in-a-baseband-pulse-transmission-system", "bandwidth-estimation-from-dimensionality-theorem", "raised-cosine-nyquist-filtering"]
tags: ["nyquist-first-criterion", "sinc-pulse", "zero-isi", "sampling-moments", "nyquist", "final-topic"]
source_images: ["/communication-1/assets/communications-1-coursereader-page-090-2.png", "/communication-1/assets/communications-1-coursereader-page-091-2.png"]
---

## Nyquist zero-ISI criterion and ideal sinc pulses

Source: [[communications-1-coursereader|Communications 1 Course Reader - Sampling, PAM, PCM, and Noise]]

Locations: Page 90, Page 91

Nyquist's first criterion states that to avoid ISI, the effective pulse seen at the receiver must have a nonzero value only at its own sampling instant and zero at all other symbol-spaced sampling instants. The text identifies the sinc pulse as the simplest ideal waveform satisfying this condition. A worked visualization transmits the binary pattern for the letter 'N', $01001110$, using overlapping sinc pulses spaced by $T_s$. Although the sinc pulses overlap in time, their zero crossings align exactly with neighboring sampling instants, so the total waveform evaluates to the intended symbol value at each sample time. This is the key insight of zero-ISI signaling: overlap in time is allowed as long as there is no interference at the sampling moments. The chapter also notes that other ideal zero-ISI waveforms such as rectangular and triangular forms exist in theory, but perfect implementations are not practical because they require infinite bandwidth or infinite time support. Thus, ideal sinc pulses serve as a conceptual benchmark rather than a realizable pulse shape.

### Source snapshots

![Communications_1_CourseReader Page 90](/communication-1/assets/communications-1-coursereader-page-090-2.png)

![Communications_1_CourseReader Page 91](/communication-1/assets/communications-1-coursereader-page-091-2.png)

### Page-grounded details

#### Page 90

8.5 Nyquists first method (Zero ISI)
The simplest waveform (or pulse) that satisfies Nyquist's first criterion is a sinc pulse. To
see why a sinc pulse satisfies Nyquist's first criterion and does not spread, we recall Eqn.
(108). The equation states that a transmitted pulse must only have a non-zero value on its
designated timeslot for sampling, and zero on any other kTs sampling timeslot. A ideal sinc
pulse satisfies this condition. To demonstrate this concept, assume we want to transmit the
letter 'N' (in binary 01001110) using sinc pulses. Figure 62 contains a plot of these sinc
pulses transmitted every kTs
-1
-0.5
0
0.5
1
Amplitude
0 	1 	0 	0 	1 	1 	1 	0
Time	0 	Ts 	2Ts 	3Ts 	4Ts 	5Ts 	6Ts 	7Ts
k=0 	k=1 	k=2 	k=3 	k=4 	k=5 	k=6 	k=7
Sampling moments
Figure 62: Sinc pulses representing letter N in binary, transmitted every kTs.
Now, the final waveform (which is the sinc pulses summed together) is plotted in Fig.
63
-1
-0.5
0
0.5
1
Amplitude
0 	1 	0 	0 	1 	1 	1 	0
Time	0 	Ts 	2Ts 	3Ts 	4Ts 	5Ts 	6Ts 	7Ts
k=0 	k=1 	k=2 	k=3 	k=4 	k=5 	k=6 	k=7
Sampling moments
Figure 63: Actual final overlapped sinc pulses waveform representing letter N in binary, with sam-
pling moments kTs. The

[Truncated for analysis]

#### Page 91

We can observe in the final waveform composed of the sinc pulses (Fig. 63), that at exactly
the sampling moments kTs, the value of the waveform is either 1 or -1. This shows that
ideal sinc pulses are zero-ISI pulses because the sinc pulse transmitted on time 0 is only
non-zero (contains an amplitude of -1) on time 0. In times Ts, 2Ts, 3Ts, . . . , 7Ts, it has zero
amplitude, thus not interfering with the amplitude of the pulses on adjacent timeslots. And
the same holds also for the sinc pulses transmitted at time Ts, 2Ts,..., 7Ts, they have zero
amplitudes at other timeslots apart from their designated timeslots, and do not interfere
with the amplitude of the pulses on the adjacent timeslots. This essentially makes sinc
pulses zero-ISI.
Types of waveform pulses which satisfy zero-ISI criteria are summarized in Fig. 64.
nia	m	o	D	ycneu	qerF	nia	m	o	D	e	m	iT
1.0
T
--
2
T
--
2
	- 	3
--
T
- 	2
--
T
- 	1
--
T
1
--
T
2
--
T
-
(a) Rectangular Pulse and Its Spectrum
(b) Sa( x) Pulse and Its Spectrum
(c) Trian gular Pulse and Its Spectrum
2WSa( 2∏Wt)
T 	Sa2( ∏Tf )
T 	Sa( ∏Tf )
(	(t
--
T
(	(t
--
T
T	- T
1.0T
1.0T
0.5T
0.5T
f	t
1.0
1
---
	2W
1
	----
	2W
1
--
W
3
--
T
- 	2
--
T
- 	1
--
T
1
--

[Truncated for analysis]

### Key points

- Nyquist zero-ISI requires zero contribution from other pulses at each sampling instant.
- Ideal sinc pulses satisfy the zero-ISI condition.
- Sinc pulses can overlap in time without causing errors at sampling moments.
- The example uses the binary letter 'N' represented as 01001110.
- At sampling instants, the summed waveform equals either 1 or -1.
- Ideal zero-ISI pulses are generally impractical in real systems.

### Related topics

- [[modelling-isi-in-a-baseband-pulse-transmission-system|Modelling ISI in a baseband pulse transmission system]]
- [[bandwidth-estimation-from-dimensionality-theorem|Bandwidth estimation from dimensionality theorem]]
- [[raised-cosine-nyquist-filtering|Raised-cosine Nyquist filtering]]

### Relationships

- derives-from: [[raised-cosine-nyquist-filtering|Raised-cosine Nyquist filtering]]
