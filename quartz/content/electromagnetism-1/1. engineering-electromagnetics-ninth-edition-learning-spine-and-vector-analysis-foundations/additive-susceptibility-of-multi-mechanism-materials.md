---
title: "1.364 Additive Susceptibility of Multi-Mechanism Materials"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 589, final paragraph and Equation (E.24)"]
related: ["electric-susceptibility-and-relative-permittivity", "resonant-susceptibility-and-complex-permittivity", "dipole-relaxation-susceptibility", "microwave-absorption-by-polar-water"]
---

# 1.364 Additive Susceptibility of Multi-Mechanism Materials

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 589, final paragraph and Equation (E.24)

A real dielectric need not be governed by only one microscopic response. It may have several distinct bound-charge resonances and may also contain permanent dipoles that contribute an orientational relaxation response. In the frequency domain, linear response permits these contributions to be added directly. The source writes the total electric susceptibility as
$$
\chi_e=\chi_{\mathrm{rel}}+\sum_{i=1}^{n}\chi_{\mathrm{res}}^i
$$
 where $\chi_{\mathrm{rel}}$ is the dipole-relaxation susceptibility, $\chi_{\mathrm{res}}^i$ is the susceptibility associated with the $i$th resonant frequency, and $n$ is the number of resonances. Each component contributes its own real and imaginary frequency dependence. Their sum determines the material's overall complex permittivity, refractive-index dispersion, attenuation spectrum, and characteristic relaxation behavior. This superposition rule provides a practical modeling framework: identify the relevant microscopic mechanisms, assign each an appropriate complex susceptibility, and sum the components before calculating macroscopic wave propagation.

## Page-Grounded Details

#### Page 589

The complex susceptibility associated with dipole relaxation is essentially that of an "overdamped" oscillator, and is given by
$$
\chi_{\rm rel}=\frac{Np^{2}/\epsilon_{0}}{3\,k_{B}\,T(1+j\omega\tau)}\quad{(E.23)}
$$
where $p$ is the permanent dipole moment magnitude of each molecule, $k_{B}$ is Boltzmann's constant, and $T$ is the temperature in degees Kelvin. $\tau$ is the thermal randomization time, defined as the time for the polarization, P, to relax to 1/e of its original value when the field is turned off. $\chi_{\rm rel}$ is complex, and so it will possess absorptive and dispersive components (imaginary and real parts) as we found in the resonant case. The form of Eq. (E.23) is identical to that of the response of a series RC circuit driven by a sinusoidal voltage (where $\tau$ becomes RC).

Microwave absorption in water occurs through the relaxation mechanism in polar water molecules, and is the primary means by which microwave cooking is done, as discussed in Chapter 11. Frequencies near 2.5 GHz are typically used, since these provide the optimum penetration depth. The peak water absorption arising from dipole relaxation occurs at much higher frequencies, ho

[Truncated for analysis]

## Core Ideas

- A material can possess multiple resonant responses.
- The same material can also exhibit permanent-dipole relaxation.
- Linear frequency-domain susceptibilities add directly.
- $\chi_{\mathrm{res}}^i$ represents the contribution of resonance $i$.
- $n$ is the number of modeled resonances.
- The summed susceptibility determines the total complex permittivity.

## Source Anchors

- Page 589 states that a material may possess more than one resonance and a dipole-relaxation response.
- Equation (E.24):
$$
\chi_e=\chi_{\mathrm{rel}}+\sum_{i=1}^{n}\chi_{\mathrm{res}}^i
$$
- The source defines $\chi_{\mathrm{res}}^i$ as the susceptibility associated with the $i$th resonant frequency.
- The source defines $n$ as the number of resonances in the material.

## Related Pages

- [[electric-susceptibility-and-relative-permittivity|Electric Susceptibility and Relative Permittivity]]
- [[resonant-susceptibility-and-complex-permittivity|Resonant Susceptibility and Complex Permittivity]]
- [[dipole-relaxation-susceptibility|Dipole Relaxation Susceptibility]]
- [[microwave-absorption-by-polar-water|Microwave Absorption by Polar Water]]

## Concept Dependencies

- depends-on: [[resonant-susceptibility-and-complex-permittivity|Resonant Susceptibility and Complex Permittivity]]
- depends-on: [[dipole-relaxation-susceptibility|Dipole Relaxation Susceptibility]]
- part-of: [[electric-susceptibility-and-relative-permittivity|Electric Susceptibility and Relative Permittivity]]
