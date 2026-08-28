---
title: "1.233 Skin-Effect Resistance"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 406, Figure 11.3", "Page 407", "Page 408"]
related: ["skin-depth-and-field-confinement", "good-conductor-intrinsic-impedance-and-power-density", "poynting-vector-and-electromagnetic-energy-conservation", "good-conductor-propagation-approximation"]
---

# 1.233 Skin-Effect Resistance

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 406, Figure 11.3, Page 407, Page 408

Skin effect makes conductor resistance frequency dependent because alternating current density is concentrated near the surface rather than distributed uniformly through the full cross section. Figure 11.3 considers a conductor of length $L$, width $b$, and infinite depth, with surface current density $J_{x0}$ decaying as $J_{xs}=J_{x0}e^{-(1+j)z/\delta}$. Integrating the Poynting-vector power crossing the surface gives $P_L=\delta bLJ_{x0}^2/(4\sigma)$. Independently integrating the current density over depth gives a total current equivalent to a uniform current density occupying a layer of thickness $\delta$. The resulting average ohmic loss is identical. Therefore, for resistance calculations, the actual exponentially distributed current may be replaced by a uniform current occupying one skin depth. For a round conductor with radius $a\gg\delta$, the effective cross-sectional area is approximately circumference times skin depth, $2\pi a\delta$, giving $R=L/(2\pi a\sigma\delta)$. A copper wire of radius 1 mm and length 1 km has $R_{dc}=5.48\ \Omega$, but at 1 MHz, where $\delta=0.066\ \mathrm{mm}$, its resistance rises to $41.5\ \Omega$.

## Page-Grounded Details

#### Page 406

which may be written as
$$
\eta=\frac{\sqrt{2}\angle 45^{\circ}}{\sigma\delta}=\frac{(1+j)}{\sigma\delta}\quad{(85)}
$$
Thus, if we write (80) in terms of the skin depth,
$$
E_{x}=E_{x0}e^{-z/\delta}\cos\left(\omega t-\frac{z}{\delta}\right)\quad{(86)}
$$
then
$$
H_{y}=\frac{\sigma\delta E_{x0}}{\sqrt{2}}e^{-z/\delta}\cos\left(\omega t-\frac{z}{\delta}-\frac{\pi}{4}\right)\quad{(87)}
$$
and we see that the maximum amplitude of the magnetic field intensity occurs one-eighth of a cycle later than the maximum amplitude of the electric field intensity at every point.

From (86) and (87) we may obtain the time-average Poynting vector by applying (77),
$$
\langle S_{z}\rangle=\frac{1}{2}\frac{\sigma\delta E_{x0}^{2}}{\sqrt{2}}e^{-2z/\delta}\cos\left(\frac{\pi}{4}\right)
$$
or
$$
\langle S_{z}\rangle=\frac{1}{4}\sigma\delta E_{x0}^{2}e^{-2z/\delta}
$$
We again note that in a distance of one skin depth the power density is only $e^{-2}$ = 0.135 of its value at the surface.

#### 11.4.4 Skin Effect Resistance in Conductors

We are now prepared to address the problem of frequency-dependent resistance in conductors, which is an important factor in the operation of transmission lin

[Truncated for analysis]

#### Page 407

from $z<0$. The incident electric field is x-polarized and thus generates current density J in that direction, which diminishes with increasing $z$ as the wave attenuates. The total average power loss in a width $0<y<b$ and length $0<x<L$ in the direction of the current as shown and at depth $z$ is obtained by finding the power crossing the conductor surface within this area,
$$
P_{L}=\int_{\mathrm{area}}\langle S_{z}\rangle da=\int_{0}^{b}\int_{0}^{L}\frac{1}{4}\sigma\delta E_{x0}^{2}e^{-2z/\delta}\bigg|_{\substack{z=0}}\\ dxdy=\frac{1}{4}\sigma\delta bL E_{x0}^{2}
$$
In terms of the current density $J_{x0}$ at the surface,
$$
J_{x0}=\sigma E_{x0}
$$
we have
$$
P_{L}=\frac{1}{4\sigma}\delta bLJ_{x0}^{2}\quad{(88)}
$$
Now let us see what power loss would result if the total current in a width $b$ were distributed uniformly in one skin depth. To find the total current, we integrate the current density over the infinite depth of the conductor,
$$
I=\int_{0}^{\infty}\int_{0}^{b}J_{x}dy\,dz
$$
where
$$
J_{x}=J_{x0}\,e^{-z/\delta}\cos\Big{(}\omega t-\frac{z}{\delta}\Big{)}
$$
or in complex exponential notation to simplify the integration,
$$
\begin{align*}J_{xs}

[Truncated for analysis]

#### Page 408

The time-average power loss is easily obtained, since the average value of the cosine-squared factor is one-half
$$
 P_{L}=\frac{1}{4\sigma}J_{x0}^{2}bL\delta
$$
(89)

Comparing (88) and (89), we see that they are identical. Thus the average power loss in a conductor with skin effect present may be calculated by assuming that the total current is distributed uniformly in one skin depth. In terms of resistance, we may say that the resistance of a width b and length L of an infinitely thick slab with skin effect is the same as the resistance of a rectangular slab of width b, length L, and thickness $\delta$ without skin effect, or with uniform current distribution.

We may apply this to a conductor of circular cross section with little error, provided that the radius a is much greater than the skin depth. The resistance at a high frequency where there is a well-developed skin effect is therefore found by considering a slab of width equal to the circumference $2\pi a$ and thickness $\delta$. Hence
$$
 R=\frac{L}{\sigma S}=\frac{L}{2\pi a\sigma\delta}
$$
(90)

A round copper wire of 1 mm radius and 1 km length has a resistance at direct current of
$$
 R_{dc}=\frac{10^{3}}{\pi

[Truncated for analysis]

## Core Ideas

- Surface current density decays as $e^{-(1+j)z/\delta}$.
- The conductor loss is $P_L=\delta bLJ_{x0}^2/(4\sigma)$.
- The integrated current is equivalent to uniform current occupying one skin depth.
- Skin-effect resistance uses an effective conducting thickness $\delta$.
- For a round wire with $a\gg\delta$, $R=L/(2\pi a\sigma\delta)$.
- Because $\delta$ decreases with frequency, effective resistance increases with frequency.
- A 1 km copper wire of 1 mm radius rises from $5.48\ \Omega$ at dc to $41.5\ \Omega$ at 1 MHz.

## Source Anchors

- Figure 11.3 shows $J_x=J_{x0}e^{-z/\delta}e^{-jz/\delta}$ and identifies the associated average power loss.
- Equation (88) gives $P_L=\delta bLJ_{x0}^2/(4\sigma)$ from surface power flow.
- The current integration gives $I_s=J_{x0}b\delta/(1+j)$.
- Equation (89) reproduces the same average loss under the uniform-one-skin-depth model.
- Equation (90) gives $R=L/(2\pi a\sigma\delta)$ for a circular conductor.
- Exercise D11.7 applies the method to a steel pipe and gives $\delta=0.766\ \mathrm{mm}$, effective resistance $0.557\ \Omega$, dc resistance $0.249\ \Omega$, and average loss $17.82\ \mathrm{W}$.

## Related Pages

- [[skin-depth-and-field-confinement|Skin Depth and Field Confinement]]
- [[good-conductor-intrinsic-impedance-and-power-density|Good-Conductor Intrinsic Impedance and Power Density]]
- [[poynting-vector-and-electromagnetic-energy-conservation|Poynting Vector and Electromagnetic Energy Conservation]]
- [[good-conductor-propagation-approximation|Good-Conductor Propagation Approximation]]

## Concept Dependencies

- depends-on: [[skin-depth-and-field-confinement|Skin Depth and Field Confinement]]
- derives-from: [[good-conductor-intrinsic-impedance-and-power-density|Good-Conductor Intrinsic Impedance and Power Density]]
- applies-to: [[poynting-vector-and-electromagnetic-energy-conservation|Poynting Vector and Electromagnetic Energy Conservation]]
