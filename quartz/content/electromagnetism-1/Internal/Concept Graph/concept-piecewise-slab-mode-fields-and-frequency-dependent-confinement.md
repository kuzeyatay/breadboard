---
title: "Piecewise Slab Mode Fields and Frequency-Dependent Confinement"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "piecewise-slab-mode-fields-and-frequency-dependent-confinement"
locations: ["Page 509, Figure 13.21 and Eq. (136)", "Page 510, Eqs. (137)-(138) and confinement discussion"]
related: ["even-and-odd-slab-modes-from-plane-wave-superposition", "evanescent-surface-waves-and-dielectric-guide-confinement", "slab-transverse-resonance-and-single-mode-cutoff"]
---

## ConceptNode: Piecewise Slab Mode Fields and Frequency-Dependent Confinement

Planning node for [[piecewise-slab-mode-fields-and-frequency-dependent-confinement|1.292 Piecewise Slab Mode Fields and Frequency-Dependent Confinement]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 509, Figure 13.21 and Eq. (136), Page 510, Eqs. (137)-(138) and confinement discussion

A complete slab mode combines an oscillatory core field with exponentially decaying exterior fields and enforces tangential electric-field continuity at $x=\pm d/2$. Even TE modes use a cosine inside the slab and equal-sign exponential tails above and below. Odd TE modes use a sine inside and opposite signs for the two exterior tails. Unlike a metallic guide, the field need not vanish at the dielectric interfaces; it joins continuously to the evanescent fields. TM modes have nearly the same spatial form, but their plane-wave polarization is rotated by 90 degrees, so $H_y$ follows the same type of profile as $E_y$ in a TE mode. The guide supports a finite discrete set of modes at a given frequency, with more modes becoming available as frequency increases. At cutoff, a dielectric mode has $\theta_1=\theta_c$, not zero angle as in a metallic guide. Raising frequency increases $\theta_1$ and $\gamma_2$, tightening an existing mode's confinement. At one frequency, higher-order modes have smaller angles, smaller decay coefficients, and more power outside the slab than lower-order modes.

### Key planning details

- Tangential $E_y$ is continuous at both dielectric interfaces.
- Even TE modes have cosine core fields and symmetric exponential tails.
- Odd TE modes have sine core fields and antisymmetric signed tails.
- Dielectric-interface fields generally do not vanish at the boundaries.
- TM spatial profiles resemble TE profiles after a 90-degree polarization rotation.
- The number of allowed discrete modes increases with frequency.
- At dielectric-guide cutoff, $\theta_1=\theta_c$.
- Existing modes become more tightly confined as their frequency rises.
- At fixed frequency, higher-order modes place a greater power fraction outside the slab.

### Source coverage

- S1.P509.F1, Figure 13.21, shows the first three TE transverse field profiles with oscillatory slab fields and exterior exponential tails.
- Equation (136): $$E_{y1}|_{x=\pm d/2}=E_{y2}|_{x=\pm d/2}.$$
- Equation (137) gives the three-region even TE field with a cosine core and matched exponential tails.
- Equation (138) gives the three-region odd TE field with a sine core and opposite signs below and above the slab.
- The source states that TE magnetic fields have x and z components and that TM modes produce an $H_y$ profile analogous to TE $E_y$.
- Page 510 states that $\gamma_2$ rises with $\theta_1$, causing stronger confinement as frequency increases.
- Page 510 states that higher-order modes at a common frequency have lower $\gamma_2$ and more power in the surrounding regions.
