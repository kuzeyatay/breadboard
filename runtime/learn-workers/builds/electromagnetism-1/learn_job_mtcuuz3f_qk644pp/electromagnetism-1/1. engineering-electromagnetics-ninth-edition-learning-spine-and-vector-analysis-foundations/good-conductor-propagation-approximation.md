---
title: "1.229 Good-Conductor Propagation Approximation"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 401", "Page 402", "Page 403"]
related: ["conductivity-as-imaginary-permittivity", "skin-depth-and-field-confinement", "good-conductor-intrinsic-impedance-and-power-density", "skin-effect-resistance"]
---

# 1.229 Good-Conductor Propagation Approximation

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 401, Page 402, Page 403

A good conductor satisfies the high-loss condition $\epsilon''/\epsilon'\gg1$, or equivalently $\sigma/(\omega\epsilon')\gg1$. Conduction current then greatly exceeds displacement current, and ohmic loss continuously removes energy from a wave entering the material. Starting from $jk=j\omega\sqrt{\mu\epsilon'}\sqrt{1-j\sigma/(\omega\epsilon')}$, the unity term inside the radical is neglected. The resulting square root of $-j$ has phase $-45^\circ$, which leads to $jk=(1+j)\sqrt{\pi f\mu\sigma}$. Therefore the attenuation and phase constants are equal: $\alpha=\beta=\sqrt{\pi f\mu\sigma}$. An $x$-directed electric field propagating in positive $z$ becomes $E_x=E_{x0}e^{-z\sqrt{\pi f\mu\sigma}}\cos(\omega t-z\sqrt{\pi f\mu\sigma})$. With negligible displacement current, the conduction current density is directly proportional to this field: $J_x=\sigma E_x$. The source connects this conductor loss to transmission-line resistance, explaining that external fields propagate along a conductor surface while the field penetrating the conductor produces dissipative current.

## Page-Grounded Details

#### Page 401

The second-harmonic component of the integrand in (75) integrates to zero, leaving only the contribution from the dc component. The result is
$$
\langle S_{z}\rangle=\frac{1}{2}\frac{E_{x0}^{2}}{|\eta|}e^{-2\alpha z}\cos\theta_{\eta}\quad{(76)}
$$
Note that the power density attenuates as $e^{-2\alpha z}$, whereas $E_{x}$ and $H_{y}$ fall off as $e^{-\alpha z}$.

We may finally observe that the preceding expression can be obtained very easily by using the phasor forms of the electric and magnetic fields. In vector form, this is
$$
\langle S\rangle=\frac{1}{2}\mathcal{R}e(\mathbf{E}_{s}\times\mathbf{H}_{s}^{*})\quad\mathrm{W/m}^{2}\quad{(77)}
$$
In the present case
$$
\mathbf{E}_{s}=E_{x0}\,e^{-j\beta z}\mathbf{a}_{x}
$$
and
$$
\mathbf{H}_{s}^{*}=\frac{E_{x0}}{\eta^{*}}\,e^{+j\beta z}\mathbf{a}_{y}=\frac{E_{x0}}{|\eta|}e^{j\theta}e^{+j\beta z}\mathbf{a}_{y}
$$
where $E_{x0}$ has been assumed real. Eq. (77) applies to any sinusoidal electromagnetic wave and gives both the magnitude and direction of the time-average power density.

D11.6. At frequencies of 1, 100, and 3000 MHz, the dielectric constant of ice made from pure water has values of 4.15, 3.45, and 3.20, re

[Truncated for analysis]

#### Page 402

along the surface. This is the mechanism for the resistive transmission line loss that we studied in Chapter 10, and which is embodied in the line resistance parameter, R.

#### 11.4.1 Good Conductor Approximations

As implied, a good conductor has a high conductivity and large conduction currents. The energy represented by the wave traveling through the material therefore decreases as the wave propagates because ohmic losses are continuously present. When we discussed the loss tangent, we saw that the ratio of conduction current density to the displacement current density in a conducting material is given by $\sigma/\omega\epsilon^{\prime}$. Choosing a poor metallic conductor and a very high frequency as a conservative example, this ratio$^{5}$ for nichrome ($\sigma\doteq 10^{6}$) at 100 MHz is about $2\times 10^{8}$. We therefore have a situation where $\sigma/\omega\epsilon^{\prime}\gg 1$, and we should be able to make several very good approximations to find $\alpha$, $\beta$, and $\eta$ for a good conductor.

The general expression for the propagation constant is, from (59),
$$
jk=j\omega\sqrt{\mu\epsilon^{\prime}}\sqrt{1-j\frac{\sigma}{\omega\epsilon^{\prime}

[Truncated for analysis]

#### Page 403

We may tie this field in the conductor to an external field at the conductor surface. We let the region $z>0$ be the good conductor and the region $z<0$ be a perfect dielectric. At the boundary surface $z=0$, (80) becomes
$$
 E_{x}=E_{x0} \operatorname{cosev}{\omega t} \qquad(z=0)
$$
We consider this to be the source field that establishes the fields within the conductor. Since displacement current is negligible
$$
 \mathbf{J}=\sigma\mathbf{E}
$$
Thus, the conduction current density at any point within the conductor is directly related to $\mathbf{E}$:
$$
 J_{x}=\sigma E_{x}=\sigma E_{x0} e^{-z\sqrt{\pi f\mu\sigma}} \operatorname{cosev}(\omega t-z\sqrt{\pi f\mu\sigma}) \quad{(81)}
$$
#### 11.4.2 Skin Effect

Equations (80) and (81) contain a wealth of information. Considering first the negative exponential term, we find an exponential decrease in the conduction current density and electric field intensity with penetration into the conductor (away from the source). The exponential factor is unity at $z=0$ and decreases to $e^{-1}=0.368$ when
$$
 z=\frac{1}{\sqrt{\pi f\mu\sigma}} $$
This distance is denoted by $\delta$ and is termed the depth of penetration, or the

[Truncated for analysis]

## Core Ideas

- The good-conductor criterion is $\sigma/(\omega\epsilon')\gg1$.
- Conduction current dominates displacement current.
- The propagation constant reduces to $jk=(1+j)\sqrt{\pi f\mu\sigma}$.
- The attenuation and phase constants are equal.
- Both constants scale as $\sqrt{f\mu\sigma}$.
- Electric field and conduction current decay exponentially with depth.
- Inside the conductor, $\mathbf{J}=\sigma\mathbf{E}$ because displacement current is negligible.
- Dissipative conductor fields account for resistive loss in transmission lines.

## Source Anchors

- Page 401 defines a good conductor by $\sigma/(\omega\epsilon')\gg1$.
- The nichrome example estimates this ratio as about $2\times10^8$ at 100 MHz.
- Equation (78) derives $jk=(1+j)\sqrt{\pi f\mu\sigma}$.
- Equation (79) gives $\alpha=\beta=\sqrt{\pi f\mu\sigma}$.
- Equation (80) gives the attenuating and phase-delayed electric field inside the conductor.
- Equation (81) gives $J_x=\sigma E_x$ with the same depth and phase dependence.

## Related Pages

- [[conductivity-as-imaginary-permittivity|Conductivity as Imaginary Permittivity]]
- [[skin-depth-and-field-confinement|Skin Depth and Field Confinement]]
- [[good-conductor-intrinsic-impedance-and-power-density|Good-Conductor Intrinsic Impedance and Power Density]]
- [[skin-effect-resistance|Skin-Effect Resistance]]

## Concept Dependencies

- enables: [[skin-depth-and-field-confinement|Skin Depth and Field Confinement]]
- enables: [[good-conductor-intrinsic-impedance-and-power-density|Good-Conductor Intrinsic Impedance and Power Density]]
