---
title: "1.224 Microwave Absorption and Penetration in Water"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 394"]
related: ["lossless-dielectric-plane-wave-propagation", "conductivity-as-imaginary-permittivity", "good-dielectric-approximation", "time-average-power-density-of-sinusoidal-waves"]
---

# 1.224 Microwave Absorption and Penetration in Water

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 394

At 2.5 GHz, water can no longer be treated as lossless because molecular dipole relaxation produces both real and imaginary permittivity. Example 11.4 uses $\epsilon'_r=78$ and $\epsilon''_r=7$. The exact lossy-medium formulas yield an attenuation coefficient $\alpha=21\ \mathrm{Np/m}$ and phase constant $\beta=464\ \mathrm{rad/m}$. The distance over which the field amplitude falls to $e^{-1}$ of its surface value is $1/\alpha=4.8\ \mathrm{cm}$, identified here as the penetration depth. This frequency-dependent absorption explains the operating principle of microwave ovens: water-containing food absorbs microwave energy and converts it into heat. If frequency is much higher, increased loss can make penetration too shallow and concentrate heating near the surface. If frequency is lower, penetration becomes greater but total absorption may be insufficient. The wavelength in water is $1.4\ \mathrm{cm}$, compared with $12\ \mathrm{cm}$ in free space. The intrinsic impedance is complex, $\eta=43+j1.9=43\angle2.6^\circ\ \Omega$, so the electric field leads the magnetic field by $2.6^\circ$.

## Page-Grounded Details

#### Page 394

### EXAMPLE 11.4

We again consider plane wave propagation in water, but at the much higher microwave frequency of 2.5 GHz. At frequencies in this range and higher, dipole relaxation and resonance phenomena in the water molecules become important.^2 Real and imaginary parts of the permittivity are present, and both vary with frequency. At frequencies below that of visible light, the two mechanisms together produce a value of $e^{\prime\prime}$ that increases with increasing frequency, reaching a maximum in the vicinity of $10^{13}$ Hz. $e^{\prime}$ decreases with increasing frequency, reaching a minimum also in the vicinity of $10^{13}$ Hz. Reference 3 provides specific details. At 2.5 GHz, dipole relaxation effects dominate. The permittivity values are $\epsilon_{r}^{\prime}=78$ and $\epsilon_{r}^{\prime\prime}=7$. From (44), we have
$$
\alpha=\frac{(2\pi\times 2.5\times 10^{9})\sqrt{78}}{(3.0\times 10^{8})\sqrt{2}}\left(\sqrt{1+\left(\frac{7}{78}\right)^{2}}-1\right)^{1/2}=21~{}\mathrm{Np/m}
$$
This first calculation demonstrates the operating principle of the microwave oven. Almost all foods contain water, and so they can be cooked when incident microwave radiation

[Truncated for analysis]

## Core Ideas

- At 2.5 GHz, water has $\epsilon'_r=78$ and $\epsilon''_r=7$.
- Dipole relaxation dominates the dielectric loss at this frequency.
- The attenuation coefficient is $\alpha=21\ \mathrm{Np/m}$.
- The field penetration depth is $1/\alpha=4.8\ \mathrm{cm}$.
- The phase constant is $\beta=464\ \mathrm{rad/m}$.
- The wavelength is $1.4\ \mathrm{cm}$ in water and $12\ \mathrm{cm}$ in free space.
- The intrinsic impedance is $43+j1.9\ \Omega$.
- The complex impedance causes the electric field to lead the magnetic field by $2.6^\circ$.

## Source Anchors

- Example 11.4 states that real and imaginary permittivity vary with frequency because of dipole relaxation and resonance.
- The exact attenuation calculation gives $\alpha=21\ \mathrm{Np/m}$.
- The source identifies $1/\alpha=4.8\ \mathrm{cm}$ as the penetration depth.
- The source explains microwave heating as conversion of absorbed radiation into heat in water-containing food.
- The exact phase calculation gives $\beta=464\ \mathrm{rad/m}$ and $\lambda=1.4\ \mathrm{cm}$.
- The impedance calculation gives $\eta=43\angle2.6^\circ\ \Omega$.

## Related Pages

- [[lossless-dielectric-plane-wave-propagation|Lossless Dielectric Plane-Wave Propagation]]
- [[conductivity-as-imaginary-permittivity|Conductivity as Imaginary Permittivity]]
- [[good-dielectric-approximation|Good-Dielectric Approximation]]
- [[time-average-power-density-of-sinusoidal-waves|Time-Average Power Density of Sinusoidal Waves]]

## Concept Dependencies

- related: [[conductivity-as-imaginary-permittivity|Conductivity as Imaginary Permittivity]]
- applies-to: [[time-average-power-density-of-sinusoidal-waves|Time-Average Power Density of Sinusoidal Waves]]
