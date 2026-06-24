---
title: "Physical Channel Equation Sheet"
date: "2026-04-25T10:25:58.869Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "communications-1-coursereader"
source_file: "Communications_1_CourseReader.pdf"
locations: ["Page 147", "Section: 13 Physical channel equations"]
related: ["free-space-wireless-propagation-and-friis-equation", "single-reflection-ground-model-and-the-1-over-d-4-rule", "knife-edge-diffraction-loss-calculation", "working-with-decibels-for-power-gain-and-snr"]
tags: ["friis-equation", "knife-edge-diffraction", "delay-spread", "physical-channel-equations"]
source_images: ["/communication-1/assets/communications-1-coursereader-page-147-2.png"]
---

## Physical Channel Equation Sheet

Source: [[communications-1-coursereader|Communications 1 Course Reader - Sampling, PAM, PCM, and Noise]]

Locations: Page 147, Section: 13 Physical channel equations

The equation sheet consolidates the main formulas used across physical-channel analysis, serving as a compact map of the chapter's calculational tools. It includes free-space received power using receiver effective area, the relationship between antenna gain and area, Friis' equation, the two-ray long-distance approximation, break distance, knife-edge diffraction geometry and loss, and several additional formulas from broader channel analysis. These include Snell-like refraction relationships, mean delay, delay spread, multipath signal representation, phase change from path difference or Doppler motion, and Doppler frequency. Because the equations are presented together, they reveal the structure of channel modeling: geometry determines phase and path differences; those determine interference, fading, and diffraction; and logarithmic forms support power budgeting. This sheet is particularly useful as a reusable reference because it compresses the chapter's methods into direct symbolic form without explanatory derivations.

### Source snapshots

![Communications_1_CourseReader Page 147](/communication-1/assets/communications-1-coursereader-page-147-2.png)

### Page-grounded details

#### Page 147

13 Physical channel equations
PRx(d) = PT x
1
4πd2 ARx (192)
GRx = 4π
λ2 ARx (193)
PRx(d) = PT xGT xGRx( λ
4πd )2 (194)
sin(θt)
sin(θe) =
preal(δ1)
preal(δ2) =
√ϵ1
√ϵ2
(195)
PRx(d) ~= PT xGT xGRx( hT xhRx
d2 )2 (196)
dbreak = 4πhT xhRx
λ (197)
ν = α
s
2d1d2
λ(d1 + d2) (198)
α = β + γ (199)
β = arctan( hobs - hT x
d1
) (200)
γ = arctan( hobs - hRx
d2
) (201)
A(v) = 6.9 + 20 log10{pv2 + 1 + v - 0.1} (202)
¯τ =
P
k P (τk)τk
P
k P (τk) (203)
σtau = pAvg(τ 2) - (¯τ )2 (204)
|r(t)|2 = |
N -1	X
i=0
ai exp(jθi(t, τ )|2 (205)
∆ϕ = 2π∆l
λ = 2πν∆t
λ cos(θ) (206)
fd = 1
2π
∆ϕ
∆t = ν
λ cos(θ) (207)
143

### Key points

- The sheet restates the free-space power and Friis equations.
- It includes the two-ray long-distance approximation and break distance.
- Knife-edge analysis is summarized through $\nu$, $\alpha$, $\beta$, $\gamma$, and $A(\nu)$.
- Delay statistics appear through mean excess delay and delay spread formulas.
- Multipath reception is modeled as a sum of phasors.
- Phase difference and Doppler frequency are connected to path change and motion.

### Related topics

- [[free-space-wireless-propagation-and-friis-equation|Free-Space Wireless Propagation and Friis Equation]]
- [[single-reflection-ground-model-and-the-1-over-d-4-rule|Single-Reflection Ground Model and the $1/d^4$ Rule]]
- [[knife-edge-diffraction-loss-calculation|Knife-Edge Diffraction Loss Calculation]]
- [[working-with-decibels-for-power-gain-and-snr|Working with Decibels for Power, Gain, and SNR]]

### Relationships

- related: [[free-space-wireless-propagation-and-friis-equation|Free-Space Wireless Propagation and Friis Equation]]
- related: [[single-reflection-ground-model-and-the-1-over-d-4-rule|Single-Reflection Ground Model and the $1/d^4$ Rule]]
- related: [[knife-edge-diffraction-loss-calculation|Knife-Edge Diffraction Loss Calculation]]
