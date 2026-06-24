---
title: "Knife-Edge Diffraction Loss Calculation"
date: "2026-04-25T10:25:58.869Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "communications-1-coursereader"
source_file: "Communications_1_CourseReader.pdf"
locations: ["Page 138", "Page 139", "Page 144", "Section: 11.4.4 Knife Edge", "Section: 11.6 Exercises"]
related: ["free-space-wireless-propagation-and-friis-equation", "single-reflection-ground-model-and-the-1-over-d-4-rule", "working-with-decibels-for-power-gain-and-snr", "physical-channel-equation-sheet"]
tags: ["knife-edge-diffraction", "diffraction-loss", "received-power", "dbw", "final-topic"]
source_images: ["/communication-1/assets/communications-1-coursereader-page-138-2.png", "/communication-1/assets/communications-1-coursereader-page-139-2.png"]
---

## Knife-Edge Diffraction Loss Calculation

Source: [[communications-1-coursereader|Communications 1 Course Reader - Sampling, PAM, PCM, and Noise]]

Locations: Page 138, Page 139, Page 144, Section: 11.4.4 Knife Edge, Section: 11.6 Exercises

Knife-edge analysis models the extra attenuation caused when an obstacle blocks the RF path. The procedure in the text is explicitly computational: first determine the obstruction angle using geometry, then compute wavelength from frequency, then calculate the Fresnel-Kirchhoff parameter $\nu$, and finally determine diffraction loss $A(\nu)$ in dB. The received power is then obtained by combining the appropriate propagation model with the diffraction penalty. The worked example uses $P_{Tx}=1\,\mathrm{W}$, unit transmit and receive gains, $f=1\,\mathrm{GHz}$, an obstacle height of 70 m, transmitter height 50 m, receiver height 1 m, and distances $d_1=2000\,\mathrm{m}$ and $d_2=200\,\mathrm{m}$. Because the total path length exceeds the calculated break distance, the two-ray $1/d^4$ approximation is used before subtracting diffraction loss. This yields a final received power of about $-134.14\,\mathrm{dBW}$. The text also notes that if total distance is below the break distance, Friis' free-space formula should be used instead.

### Source snapshots

![Communications_1_CourseReader Page 138](/communication-1/assets/communications-1-coursereader-page-138-2.png)

![Communications_1_CourseReader Page 139](/communication-1/assets/communications-1-coursereader-page-139-2.png)

### Page-grounded details

#### Page 138

11.4.4 Knife Edge
To analyze diffraction and other effects in relation to wireless propagation, we can take a
look at the "Knife Edge" style situations.
These are the case where an object is blocking the RF path, as in the depiction below.
Consider the following details, and the fact that the transmission power is equal to 1W.
Moreover the gain of TX and RX are 1 (0 dB).
Let's imagine that we are operating at a frequency of 1GHz, and we are tasked with com-
puting the received power.
Firstly, we will need to compute α, in the following manner (using pre-knowledge trig
relations).
α = β + γ (175)
= arctan( hobs - hT x
d1
) + arctan( hobs - hRx
d2
) (176)
= arctan( 70 - 50
2000 ) + arctan( 70 - 1
200 ) (177)
= 0.3422 (178)
Since we are given the operating frequency, we compute the wavelength λ = c
f = 0.3m.
Next we can compute ν,
134

#### Page 139

ν = α
s
2d1d2
λ(d1 + d2) (179)
= 0.3422
s
2 * 2000 * 200
0.3(2000 + 200) (180)
= 11.9138 (181)
This allows to compute the power loss,
A(v) = Ploss = 6.9 + 20 log10{pv2 + 1 + v - 0.1} (182)
= 6.9 + 20 log10{p11.91382 + 1 + 11.9138 - 0.1} (183)
= 34.42 dB (184)
Before continuing, we must compute the dbreak, given by
dbreak = 4πhT xhRx
λ = 4 * π * 50 * 1
0.3 = 2094.4m (185)
As mentioned before, we must use the equation which corresponds either to the case of
dtotal < dbreak or dtotal > dbreak.
Since in this case, the total distance between TX and RX is above dbreak, the following
equation is used:
PRx(d) ~= PT xGT xGRx( hT xhRx
d2 )2 (186)
= PT xGT xGRx( 50 * 1
(2000 + 200)2 )2 (187)
= 1.0672 * 10-10W = -99.7175 dBW. (188)
Thus we reach the final calculation, based on the free-space loss and the added loss from
the diffraction.
PRX = PRx(d) - Ploss = -99.7175 - 34.42 = -134.1375 dBW (189)
As a practice exercise, attempt the problem for an operating frequency of 2GHz
instead. Hint: recompute dbreak.
The alternative equation (for the dtotal < dbreak scenario) is
PRx(d) = PT xGT xGRx( λ
4πd )2 (190)
135

#### Page 144

11.6 Exercises
Question 33
Given the following geometry determine:
a. The added loss due to the knife-edge diffraction,
b. The height of the obstacle for the case of 6 dB diffraction loss (assume f=800 MHz)
140

### Key points

- Knife-edge loss begins by computing the geometric angle $\alpha=\beta+\gamma$.
- The wavelength is found from $\lambda = c/f$.
- The diffraction parameter is $$\nu = \alpha\sqrt{\frac{2d_1d_2}{\lambda(d_1+d_2)}}.$$
- The diffraction loss is $$A(\nu)=6.9+20\log_{10}\left(\sqrt{\nu^2+1}+\nu-0.1\right).$$
- A break-distance check determines whether to use free-space propagation or the $1/d^4$ model.
- The final received power is propagation power minus knife-edge loss in dB.
- The worked example gives a large loss because both diffraction and long-distance propagation are present.

### Related topics

- [[free-space-wireless-propagation-and-friis-equation|Free-Space Wireless Propagation and Friis Equation]]
- [[single-reflection-ground-model-and-the-1-over-d-4-rule|Single-Reflection Ground Model and the $1/d^4$ Rule]]
- [[working-with-decibels-for-power-gain-and-snr|Working with Decibels for Power, Gain, and SNR]]
- [[physical-channel-equation-sheet|Physical Channel Equation Sheet]]

### Relationships

- depends-on: [[working-with-decibels-for-power-gain-and-snr|Working with Decibels for Power, Gain, and SNR]]
