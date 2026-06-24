---
title: "Free-Space Wireless Propagation and Friis Equation"
date: "2026-04-25T10:25:58.869Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "communications-1-coursereader"
source_file: "Communications_1_CourseReader.pdf"
locations: ["Page 134", "Page 135", "Section: 11.4.2 Free space wireless propagation"]
related: ["wireless-propagation-as-spherical-power-spreading", "single-reflection-ground-model-and-the-1-over-d-4-rule", "knife-edge-diffraction-loss-calculation", "working-with-decibels-for-power-gain-and-snr"]
tags: ["friis-equation", "free-space-propagation", "antenna-gain", "wavelength", "received-power", "dbm"]
source_images: ["/communication-1/assets/communications-1-coursereader-page-134-2.png", "/communication-1/assets/communications-1-coursereader-page-135-2.png"]
---

## Free-Space Wireless Propagation and Friis Equation

Source: [[communications-1-coursereader|Communications 1 Course Reader - Sampling, PAM, PCM, and Noise]]

Locations: Page 134, Page 135, Section: 11.4.2 Free space wireless propagation

The free-space model assumes a point transmitter radiating equally in all directions. At distance $d$, the transmitter's power is spread over a sphere of area $4\pi d^2$, and the receiver captures only the fraction corresponding to its effective antenna area $A_{Rx}$. This yields a received-power expression based on transmitted power, transmitter gain, distance, and receiving area. The receiver antenna area can be related to antenna gain through $G_{Rx} = \frac{4\pi}{\lambda^2} A_{Rx}$, and substituting this relation produces Friis' equation. Friis' equation is a standard engineering tool for predicting received power in line-of-sight free space, showing dependence on transmitted power, transmit and receive gains, wavelength, and distance. The text also presents the logarithmic dB form, which makes link-budget calculations additive. A short example demonstrates that when $P_{Tx}=0\,\mathrm{dBm}$, both gains are $0\,\mathrm{dB}$, and $\lambda=4\pi\,\mathrm{m}$, the power at 1000 m is $-60\,\mathrm{dBm}$, highlighting the intuitive effect of distance on received power.

### Source snapshots

![Communications_1_CourseReader Page 134](/communication-1/assets/communications-1-coursereader-page-134-2.png)

![Communications_1_CourseReader Page 135](/communication-1/assets/communications-1-coursereader-page-135-2.png)

### Page-grounded details

#### Page 134

11.4 Wireless channel
11.4.1 RF propagation
The basic rule for calculating the power distribution of a wireless transmission system
assumes power propagates in all directions equally on the surface of a sphere whose center
is at the transmitter site.
Figure 93: Energy is radiating in concentric spheres from the antenna to reach a user
In addition to the propagation losses, RF radiation is prone to atmospheric absorption. The
amount of absorption is a function of the frequency and the humidy as can be seen in Figure
94.
Figure 94: Attenuation of Radio waves as a function of frequency and humidity levels
11.4.2 Free space wireless propagation
The most simplified model for the energy to spread from the transmitter (in free space) is
to assume a point transmitter emitting equal power in all directions. At a distance d one
can imagine the power being equally distributed on the surface of a sphere with a surface
area equal to 4πd2. The amount of power captured by the receiver can be simply calculated
130

#### Page 135

by asking how large is the size (area) of the receiver antenna ARx compared with the total
area of the sphere. Hence we obtain Equation 159:
PRx(d) = PT xGT x
1
4πd2 ARx (159)
For a given antenna, one can define the antenna gain, the ratio between the amount of
power collected in the desired direction to a similar antenna with equal gain in all direction
(omnidirectional antenna), using the formula below:
GRx = 4π
λ2 ARx (160)
Which when substituting into Equation 159 gives us Frii's equation.
PRx(d) = PT xGT xGRx( λ
4πd )2 (161)
Applying the logarithmic scaling to calculate the power in dB we can write:
PRx(d)[dBm] = PT x + GT x + GRx + 20log10( λ
4πd ) (162)
Example
If the power of the transmitter is 0dBm and both transmitter and receive gains are 0dB,
what would be the power at a distance of 1000 meters from the antenna if the λ = 4π
[meter] ?
We can simply substitute the distance d into the equation and find that the power is -60dBm.
And what if the distance now doubles?
11.4.3 The case of a single reflection (Deriving the d-4 rule)
In reality, free space propagation is often not achieved in terrestrial systems. In most
case, the signal propagating from the transmit to the rece

[Truncated for analysis]

### Key points

- Received power in free space is proportional to receiving antenna area and inversely proportional to $4\pi d^2$.
- Antenna gain relates effective receiving area to wavelength by $G_{Rx} = \frac{4\pi}{\lambda^2}A_{Rx}$.
- Friis' equation is $$P_{Rx}(d)=P_{Tx}G_{Tx}G_{Rx}\left(\frac{\lambda}{4\pi d}\right)^2.$$
- In dB form, the link budget becomes additive.
- Doubling distance reduces received power according to the free-space $1/d^2$ law.
- The model is explicitly presented as the most simplified free-space case.

### Related topics

- [[wireless-propagation-as-spherical-power-spreading|Wireless Propagation as Spherical Power Spreading]]
- [[single-reflection-ground-model-and-the-1-over-d-4-rule|Single-Reflection Ground Model and the $1/d^4$ Rule]]
- [[knife-edge-diffraction-loss-calculation|Knife-Edge Diffraction Loss Calculation]]
- [[working-with-decibels-for-power-gain-and-snr|Working with Decibels for Power, Gain, and SNR]]

### Relationships

- contrasts-with: [[single-reflection-ground-model-and-the-1-over-d-4-rule|Single-Reflection Ground Model and the $1/d^4$ Rule]]
- depends-on: [[working-with-decibels-for-power-gain-and-snr|Working with Decibels for Power, Gain, and SNR]]
