---
title: "FM and PM Modulation Indices and Carson's Rule"
date: "2026-04-25T10:25:58.869Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "communications-1-coursereader"
source_file: "Communications_1_CourseReader.pdf"
locations: ["Page 123", "Page 124"]
related: ["frequency-and-phase-modulation-fundamentals", "fm-and-pm-frequency-spectrum-via-bessel-functions", "instruction-exercises-on-am-fm-and-pm"]
tags: ["modulation-index", "carsons-rule", "frequency-deviation", "phase-deviation"]
source_images: ["/communication-1/assets/communications-1-coursereader-page-123-2.png", "/communication-1/assets/communications-1-coursereader-page-124-2.png"]
---

## FM and PM Modulation Indices and Carson's Rule

Source: [[communications-1-coursereader|Communications 1 Course Reader - Sampling, PAM, PCM, and Noise]]

Locations: Page 123, Page 124

The chapter next introduces modulation indices for FM and PM and uses Carson's rule to estimate occupied bandwidth. In FM, the peak frequency deviation is the maximum instantaneous frequency shift caused by the message and is linked to the derivative of the phase. The FM modulation index is defined as $\beta_f = \Delta F/B$, where $\Delta F$ is the peak frequency deviation and $B$ is the message bandwidth. In PM, the peak phase deviation is $\Delta\theta = \max\{\theta(t)\}=D_p\max[m(t)]$, and the modulation index is simply $\beta_p = \Delta\theta$. Because FM and PM have nonlinear spectral behavior, the text says there is no simple exact spectrum formula directly analogous to conventional AM. Instead, Carson's rule provides a practical approximation for the bandwidth containing about 98% of the signal power: $$B_T = 2(\beta+1)B = 2\Delta F + 2B.$$ This rule links the occupied bandwidth to both modulation strength and message bandwidth, making it highly useful in design problems.

### Source snapshots

![Communications_1_CourseReader Page 123](/communication-1/assets/communications-1-coursereader-page-123-2.png)

![Communications_1_CourseReader Page 124](/communication-1/assets/communications-1-coursereader-page-124-2.png)

### Page-grounded details

#### Page 123

In contrast, phase modulation (PM) directly varies the phase of the carrier in proportion
to the modulating signal. Although both FM and PM maintain a constant amplitude, they
differ in how the modulating signal m(t) influences the phase term θ(t). In FM the phase
is determined by the time integral of the message signal, while in PM the phase is directly
proportional to the modulating signal.
For FM the phase is given by:
θ(t) = Df
Z t
-∞
m(τ ) dτ, (146)
and the instantaneous frequency deviation can be expressed as:
fd(t) = 1
2π
dθ(t)
dt = Df
2π m(t), (147)
where Df is the frequency deviation constant. For PM the relationship is even simpler:
θ(t) = Dp m(t), (148)
with Dp representing the phase sensitivity. In both cases the carrier amplitude Ac is main-
tained constant, which minimizes the effect of amplitude noise.
10.7.1 Frequency and phase modulation index
We begin by defining the peak frequency deviation, which represents the maximum change
in the instantaneous frequency of the carrier signal due to modulation. In frequency modu-
lation (FM), the instantaneous frequency is determined by the time derivative of the phase,
θ(t), divided by 2π. Thus, the peak frequency deviation i

[Truncated for analysis]

#### Page 124

10.7.2 Carson's Rule
In frequency and phase modulation, the signal spectrum becomes quite complex due to
the nonlinear relationship between the modulated signal g(t) and the message m(t). This
nonlinearity prevents us from deriving a simple, exact formula linking the spectrum G(f )
to M (f ).
To address this, we use a rule-of-thumb known as Carson's rule, which estimates the band-
width that contains most of the modulated signal's power. Specifically, Carson's rule states
that approximately 98% of the total power is confined within the bandwidth




BT = 2(β + 1) * B = 2∆F + 2B 	(152)
Here, β is the modulation index (which can be either the frequency or phase modulation
index), ∆F is the peak frequency deviation, and B is the bandwidth of the modulating
signal. This rule provides a practical means of estimating the spectral occupancy of a
modulated signal.
120

### Key points

- FM peak frequency deviation is the maximum instantaneous frequency shift.
- The FM modulation index is $\beta_f = \Delta F/B$.
- PM peak phase deviation is $\Delta\theta = D_p\max[m(t)]$.
- The PM modulation index is $\beta_p = \Delta\theta$.
- FM and PM spectra are nonlinear in the message signal.
- Carson's rule estimates the bandwidth containing about 98% of the total power.
- Carson's rule is $B_T = 2(\beta+1)B = 2\Delta F + 2B$.

### Related topics

- [[frequency-and-phase-modulation-fundamentals|Frequency and Phase Modulation Fundamentals]]
- [[fm-and-pm-frequency-spectrum-via-bessel-functions|FM and PM Frequency Spectrum via Bessel Functions]]
- [[instruction-exercises-on-am-fm-and-pm|Instruction Exercises on AM, FM, and PM]]

### Relationships

- depends-on: [[frequency-and-phase-modulation-fundamentals|Frequency and Phase Modulation Fundamentals]]
