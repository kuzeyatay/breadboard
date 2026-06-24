---
title: "Single-Reflection Ground Model and the $1/d^4$ Rule"
date: "2026-04-25T10:25:58.869Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "communications-1-coursereader"
source_file: "Communications_1_CourseReader.pdf"
locations: ["Page 135", "Page 136", "Section: 11.4.3 The case of a single reflection (Deriving the d-4 rule)"]
related: ["free-space-wireless-propagation-and-friis-equation", "knife-edge-diffraction-loss-calculation", "physical-channel-equation-sheet"]
tags: ["ground-reflection", "multipath-interference", "electric-field", "friis-equation", "wireless-propagation"]
source_images: ["/communication-1/assets/communications-1-coursereader-page-135-2.png", "/communication-1/assets/communications-1-coursereader-page-136-2.png"]
---

## Single-Reflection Ground Model and the $1/d^4$ Rule

Source: [[communications-1-coursereader|Communications 1 Course Reader - Sampling, PAM, PCM, and Noise]]

Locations: Page 135, Page 136, Section: 11.4.3 The case of a single reflection (Deriving the d-4 rule)

Terrestrial RF propagation often departs from free space because a strong ground-reflected component combines with the direct path. The text analyzes a two-ray model in which the received field is the sum of a direct electric field and a reflected field with approximately equal magnitude and a phase shift determined by the path-length difference. Expressions are given for direct-path and reflected-path distances, the corresponding fields, and the combined field. For large transmitter-receiver separation relative to antenna heights, the path-length difference is approximated as $d_{refl}-d_{direct}=\frac{2h_{Tx}h_{Rx}}{d}$. This leads to a phase difference $\Delta\phi$ and, under the far-distance condition, an approximate total field magnitude proportional to $\frac{h_{Tx}h_{Rx}}{\lambda d^2}$. Since received power is proportional to the square of the electric field, the power then decays as $1/d^4$ rather than the free-space $1/d^2$. The text defines a break distance $d_{break}=\frac{4\pi h_{Tx}h_{Rx}}{\lambda}$ separating the near region dominated by free-space behavior from the farther region where multipath interference dominates.

### Source snapshots

![Communications_1_CourseReader Page 135](/communication-1/assets/communications-1-coursereader-page-135-2.png)

![Communications_1_CourseReader Page 136](/communication-1/assets/communications-1-coursereader-page-136-2.png)

### Page-grounded details

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

#### Page 136

Figure 95: Radio propagation with a single reflection from the ground.
Edirect(ddirect) = E(1m)( 1
ddirect|m ) exp[j(2πfct - 2πfc
ddirect
c0
)](163)
ddirect = p(hT X - hRX )2 + d2(164)
Eref l(dref l) = (-1)E(1m)( 1
dref l|m ) exp[j(2πfct - 2πfc
dref l
c0
)](165)
dref l = p(hT X + hRX )2 + d2(166)
Etot(d) = E(1m)( 1
d[m] ){exp[j(2πfct - 2πfc
ddirect
c0
)] - exp[j(2πfct - 2πfc
dref l
c0
)]}(167)
Etot(d) = E(1m)( 1
d[m] ) exp[j(2πfct - 2πfc
ddirect
c0
)]{1 - exp[-j(2πfc
dref l - ddirect
c0
)]}(168)
dref l - ddirect = 2 hT xhRx
d (169)
|Etot(d)| ~= E(1m) 1
d[m]
q
(1 - cos(∆φ))2 + sin2(∆φ)(170)
∆φ = 2 hT xhRx
d
2πfc
c0
(171)
In the case when dlimit ≫ hT xhRx
λ , |Etot(d)| ~= E(1m) 4πhT xhRx
λd2 (172)
We define a distance dbreak as the distance where the propagation attenuation is dominated
by the multipath interference
dbreak = 4πhT xhRx
λ (173)
Which means that assuming the power is proportional to the square of the electric field, we
can write an approximated value for the power at the receiver as:
PRx(d) ~= PT xGT xGRx( hT xhRx
d2 )2 (174)
Comparing this equation to Frii's equation (Equation 161) we see that the power will drop
off with the 4th power of the distance, if d > dbreak. T

[Truncated for analysis]

### Key points

- The ground-reflection model adds a reflected field to the direct field at the receiver.
- Direct and reflected paths have different lengths, causing a phase difference.
- For large distances, path-length difference is approximated by $\frac{2h_{Tx}h_{Rx}}{d}$.
- The break distance is $$d_{break}=\frac{4\pi h_{Tx}h_{Rx}}{\lambda}.$$
- Beyond the break distance, the field falls approximately as $1/d^2$.
- Because power is proportional to field squared, received power falls as $1/d^4$ for $d>d_{break}$.
- The propagation curve therefore shows two slopes: $1/d^2$ and $1/d^4$.

### Related topics

- [[free-space-wireless-propagation-and-friis-equation|Free-Space Wireless Propagation and Friis Equation]]
- [[knife-edge-diffraction-loss-calculation|Knife-Edge Diffraction Loss Calculation]]
- [[physical-channel-equation-sheet|Physical Channel Equation Sheet]]

### Relationships

- depends-on: [[knife-edge-diffraction-loss-calculation|Knife-Edge Diffraction Loss Calculation]]
