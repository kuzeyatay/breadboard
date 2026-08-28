---
title: "Microwave Absorption and Penetration in Water"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "microwave-absorption-and-penetration-in-water"
locations: ["Page 394"]
related: ["lossless-dielectric-plane-wave-propagation", "conductivity-as-imaginary-permittivity", "good-dielectric-approximation", "time-average-power-density-of-sinusoidal-waves"]
---

## ConceptNode: Microwave Absorption and Penetration in Water

Planning node for [[microwave-absorption-and-penetration-in-water|1.224 Microwave Absorption and Penetration in Water]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 394

At 2.5 GHz, water can no longer be treated as lossless because molecular dipole relaxation produces both real and imaginary permittivity. Example 11.4 uses $\epsilon'_r=78$ and $\epsilon''_r=7$. The exact lossy-medium formulas yield an attenuation coefficient $\alpha=21\ \mathrm{Np/m}$ and phase constant $\beta=464\ \mathrm{rad/m}$. The distance over which the field amplitude falls to $e^{-1}$ of its surface value is $1/\alpha=4.8\ \mathrm{cm}$, identified here as the penetration depth. This frequency-dependent absorption explains the operating principle of microwave ovens: water-containing food absorbs microwave energy and converts it into heat. If frequency is much higher, increased loss can make penetration too shallow and concentrate heating near the surface. If frequency is lower, penetration becomes greater but total absorption may be insufficient. The wavelength in water is $1.4\ \mathrm{cm}$, compared with $12\ \mathrm{cm}$ in free space. The intrinsic impedance is complex, $\eta=43+j1.9=43\angle2.6^\circ\ \Omega$, so the electric field leads the magnetic field by $2.6^\circ$.

### Key planning details

- At 2.5 GHz, water has $\epsilon'_r=78$ and $\epsilon''_r=7$.
- Dipole relaxation dominates the dielectric loss at this frequency.
- The attenuation coefficient is $\alpha=21\ \mathrm{Np/m}$.
- The field penetration depth is $1/\alpha=4.8\ \mathrm{cm}$.
- The phase constant is $\beta=464\ \mathrm{rad/m}$.
- The wavelength is $1.4\ \mathrm{cm}$ in water and $12\ \mathrm{cm}$ in free space.
- The intrinsic impedance is $43+j1.9\ \Omega$.
- The complex impedance causes the electric field to lead the magnetic field by $2.6^\circ$.

### Source coverage

- Example 11.4 states that real and imaginary permittivity vary with frequency because of dipole relaxation and resonance.
- The exact attenuation calculation gives $\alpha=21\ \mathrm{Np/m}$.
- The source identifies $1/\alpha=4.8\ \mathrm{cm}$ as the penetration depth.
- The source explains microwave heating as conversion of absorbed radiation into heat in water-containing food.
- The exact phase calculation gives $\beta=464\ \mathrm{rad/m}$ and $\lambda=1.4\ \mathrm{cm}$.
- The impedance calculation gives $\eta=43\angle2.6^\circ\ \Omega$.
