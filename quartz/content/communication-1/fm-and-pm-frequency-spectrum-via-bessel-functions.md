---
title: "FM and PM Frequency Spectrum via Bessel Functions"
date: "2026-04-25T10:25:58.869Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "communications-1-coursereader"
source_file: "Communications_1_CourseReader.pdf"
locations: ["Page 125", "Page 126", "Page 127"]
related: ["frequency-and-phase-modulation-fundamentals", "fm-and-pm-modulation-indices-and-carsons-rule", "instruction-exercises-on-am-fm-and-pm"]
tags: ["bessel-functions", "fm-spectrum", "pm-spectrum", "sidebands", "modulation-index"]
source_images: ["/communication-1/assets/communications-1-coursereader-page-125-2.png", "/communication-1/assets/communications-1-coursereader-page-126-2.png"]
---

## FM and PM Frequency Spectrum via Bessel Functions

Source: [[communications-1-coursereader|Communications 1 Course Reader - Sampling, PAM, PCM, and Noise]]

Locations: Page 125, Page 126, Page 127

For sinusoidal angle modulation, the chapter gives a detailed spectral representation using Bessel functions. The complex envelope is written as $g(t)=A_c e^{j\beta\sin(\omega_m t)}$, leading to the transmitted signal $s(t)=A_c\cos[\omega_c t+\beta\sin(\omega_m t)]$. In the frequency domain, the envelope becomes a sum of impulses weighted by first-kind Bessel functions: $G(f)=A_c\sum_{n=-\infty}^{\infty}J_n(\beta)\delta(f-nf_m)$. The passband spectrum is then obtained by shifting this structure around the carrier. The coefficient $J_n(\beta)$ gives the amplitude of the $n$th sideband at an offset of $n f_m$ from the carrier. When $\beta$ is small, most of the power stays in the carrier and first-order sidebands; as $\beta$ grows, power spreads over many sidebands, explaining the larger occupied bandwidth of wideband FM or PM. The chapter also gives the integral definition of $J_n(\beta)$ and the symmetry relation $J_{-n}(\beta)=(-1)^nJ_n(\beta)$, and includes plots and tabulated values to visualize how sideband amplitudes change with modulation index.

### Source snapshots

![Communications_1_CourseReader Page 125](/communication-1/assets/communications-1-coursereader-page-125-2.png)

![Communications_1_CourseReader Page 126](/communication-1/assets/communications-1-coursereader-page-126-2.png)

### Page-grounded details

#### Page 125

10.8 Frequency Spectrum of FM and PM
To analyze the frequency content of FM and PM signals, we begin with the complex envelope
of the modulated signal. This envelope is given by
g(t) = Acejθ(t) = Acejβ sin(ωmt), (153)
where Ac is the carrier amplitude, β is the modulation index, and ωm is the angular fre-
quency of the modulating signal.
The transmitted signal is then obtained by combining this envelope with the carrier fre-
quency:
s(t) = ℜ{g(t)ejωct} = ℜ{Acej(β sin(ωmt)+ωct)} = Ac cos[ωct + β sin(ωmt)], (154)
where ωc is the carrier angular frequency.
In the frequency domain, the envelope g(t) has a Fourier transform represented by a sum
of delta functions weighted by Bessel functions:
G(f ) = Ac
∞	X
n=-∞
Jn(β)δ(f - nfm), (155)
and consequently, the spectrum of the modulated signal is
S(f ) = 1
2
h
G(f - fc) + G(-f - fc)
i
, (156)
with fc = ωc/(2π) being the carrier frequency and fm = ωm/(2π) the modulating frequency.
Here, Jn(β) denotes the Bessel function of the first kind of order n.
Intuitively, the Bessel functions Jn(β) describe how the modulation index β determines the
distribution of power among the spectral components (sidebands) of the modulated signal.
Each Jn(β) quant

[Truncated for analysis]

#### Page 126

Jn ( 	) J0
J1
J2
J3 	J4 	J5 	J6
2 	4 	6 	8 	10
4 	6 	8
0
0.4
0.2
0
0.2
0.4
0.6
0.8
1.0
0	1	2
( 	)
( 	)
( 	)
( 	) 	( 	) ( 	) 	( 	)
Figure 90: Visualization of various first-kind Bessel functions. [2]
FOUR-PLACE VALUES OF THE BESSEL FUNCTIONS 	Jn ( 	)b
b:
n
0.5 	1 	2 	3 	4 	5 	6 	7 	8 	9 	10
0 	0.9385 	0.7652 	0.2239 	- 0.2601 	- 0.3971 	- 0.1776 	0.1506 	0.3001 	0.1717 	- 0.09033 	- 0.2459
1 	0.2423 	0.4401 	0.5767 	0.3391 	- 0.06604 	- 0.3276 	- 0.2767 	- 0.004683 	0.2346 	0.2453 	0.04347
2 	0.03060 	0.1149 	0.3528 	0.4861 	0.3641 	0.04657 	- 0.2429 	- 0.3014 	- 0.1130 	0.1448 	0.2546
3 	0.002564 	0.01956 	0.1289 	0.3091 	0.4302 	0.3648 	0.1148 	- 0.1676 	- 0.2911 	- 0.1809 	0.05838
4 	0.002477 	0.03400 	0.1320 	0.2811 	0.3912 	0.3576 	0.1578 	- 0.1054 	- 0.2655 	- 0.2196
5 	0.007040 	0.04303 	0.1321 	0.2611 	0.3621 	0.3479 	0.1858 	- 0.05504 	- 0.2341
6 	0.001202 	0.01139 	0.04909 	0.1310 	0.2458 	0.3392 	0.3376 	0.2043 	- 0.01446
7 	0.002547 	0.01518 	0.05338 	0.1296 	0.2336 	0.3206 	0.3275 	0.2167
8 	0.004029 	0.01841 	0.05653 	0.1280 	0.2235 	0.3051 	0.3179
9 	0.005520 	0.02117 	0.05892 	0.1263 	0.2149 	0.2919
10 	0.001468 	0.006964 	0.02354 	0.06077 	0.1247 	0.2075
11 	0.00204

[Truncated for analysis]

#### Page 127

Figure 92: Frequency domain representation of an FM/PM signal, illustrating the impact of β on
the bandwidth.
123

### Key points

- Sinusoidal FM/PM can be expanded into infinitely many spectral sidebands.
- Bessel functions determine the amplitudes of those sidebands.
- The $n$th sideband appears at frequency offsets of $\pm n f_m$ from the carrier.
- Small $\beta$ concentrates power near the carrier and first-order sidebands.
- Larger $\beta$ spreads power across more sidebands.
- The detailed spectrum supports the intuition behind Carson's rule.
- The symmetry relation is $J_{-n}(\beta)=(-1)^nJ_n(\beta)$.

### Related topics

- [[frequency-and-phase-modulation-fundamentals|Frequency and Phase Modulation Fundamentals]]
- [[fm-and-pm-modulation-indices-and-carsons-rule|FM and PM Modulation Indices and Carson's Rule]]
- [[instruction-exercises-on-am-fm-and-pm|Instruction Exercises on AM, FM, and PM]]

### Relationships

- related: [[fm-and-pm-modulation-indices-and-carsons-rule|FM and PM Modulation Indices and Carson's Rule]]
- depends-on: [[frequency-and-phase-modulation-fundamentals|Frequency and Phase Modulation Fundamentals]]
