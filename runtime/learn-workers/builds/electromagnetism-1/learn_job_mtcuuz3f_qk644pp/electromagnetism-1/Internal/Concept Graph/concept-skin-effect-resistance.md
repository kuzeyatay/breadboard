---
title: "Skin-Effect Resistance"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "skin-effect-resistance"
locations: ["Page 406, Figure 11.3", "Page 407", "Page 408"]
related: ["skin-depth-and-field-confinement", "good-conductor-intrinsic-impedance-and-power-density", "poynting-vector-and-electromagnetic-energy-conservation", "good-conductor-propagation-approximation"]
---

## ConceptNode: Skin-Effect Resistance

Planning node for [[skin-effect-resistance|1.233 Skin-Effect Resistance]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 406, Figure 11.3, Page 407, Page 408

Skin effect makes conductor resistance frequency dependent because alternating current density is concentrated near the surface rather than distributed uniformly through the full cross section. Figure 11.3 considers a conductor of length $L$, width $b$, and infinite depth, with surface current density $J_{x0}$ decaying as $J_{xs}=J_{x0}e^{-(1+j)z/\delta}$. Integrating the Poynting-vector power crossing the surface gives $P_L=\delta bLJ_{x0}^2/(4\sigma)$. Independently integrating the current density over depth gives a total current equivalent to a uniform current density occupying a layer of thickness $\delta$. The resulting average ohmic loss is identical. Therefore, for resistance calculations, the actual exponentially distributed current may be replaced by a uniform current occupying one skin depth. For a round conductor with radius $a\gg\delta$, the effective cross-sectional area is approximately circumference times skin depth, $2\pi a\delta$, giving $R=L/(2\pi a\sigma\delta)$. A copper wire of radius 1 mm and length 1 km has $R_{dc}=5.48\ \Omega$, but at 1 MHz, where $\delta=0.066\ \mathrm{mm}$, its resistance rises to $41.5\ \Omega$.

### Key planning details

- Surface current density decays as $e^{-(1+j)z/\delta}$.
- The conductor loss is $P_L=\delta bLJ_{x0}^2/(4\sigma)$.
- The integrated current is equivalent to uniform current occupying one skin depth.
- Skin-effect resistance uses an effective conducting thickness $\delta$.
- For a round wire with $a\gg\delta$, $R=L/(2\pi a\sigma\delta)$.
- Because $\delta$ decreases with frequency, effective resistance increases with frequency.
- A 1 km copper wire of 1 mm radius rises from $5.48\ \Omega$ at dc to $41.5\ \Omega$ at 1 MHz.

### Source coverage

- Figure 11.3 shows $J_x=J_{x0}e^{-z/\delta}e^{-jz/\delta}$ and identifies the associated average power loss.
- Equation (88) gives $P_L=\delta bLJ_{x0}^2/(4\sigma)$ from surface power flow.
- The current integration gives $I_s=J_{x0}b\delta/(1+j)$.
- Equation (89) reproduces the same average loss under the uniform-one-skin-depth model.
- Equation (90) gives $R=L/(2\pi a\sigma\delta)$ for a circular conductor.
- Exercise D11.7 applies the method to a steel pipe and gives $\delta=0.766\ \mathrm{mm}$, effective resistance $0.557\ \Omega$, dc resistance $0.249\ \Omega$, and average loss $17.82\ \mathrm{W}$.
