---
title: "Good-Conductor Propagation Approximation"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "good-conductor-propagation-approximation"
locations: ["Page 401", "Page 402", "Page 403"]
related: ["conductivity-as-imaginary-permittivity", "skin-depth-and-field-confinement", "good-conductor-intrinsic-impedance-and-power-density", "skin-effect-resistance"]
---

## ConceptNode: Good-Conductor Propagation Approximation

Planning node for [[good-conductor-propagation-approximation|1.229 Good-Conductor Propagation Approximation]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 401, Page 402, Page 403

A good conductor satisfies the high-loss condition $\epsilon''/\epsilon'\gg1$, or equivalently $\sigma/(\omega\epsilon')\gg1$. Conduction current then greatly exceeds displacement current, and ohmic loss continuously removes energy from a wave entering the material. Starting from $jk=j\omega\sqrt{\mu\epsilon'}\sqrt{1-j\sigma/(\omega\epsilon')}$, the unity term inside the radical is neglected. The resulting square root of $-j$ has phase $-45^\circ$, which leads to $jk=(1+j)\sqrt{\pi f\mu\sigma}$. Therefore the attenuation and phase constants are equal: $\alpha=\beta=\sqrt{\pi f\mu\sigma}$. An $x$-directed electric field propagating in positive $z$ becomes $E_x=E_{x0}e^{-z\sqrt{\pi f\mu\sigma}}\cos(\omega t-z\sqrt{\pi f\mu\sigma})$. With negligible displacement current, the conduction current density is directly proportional to this field: $J_x=\sigma E_x$. The source connects this conductor loss to transmission-line resistance, explaining that external fields propagate along a conductor surface while the field penetrating the conductor produces dissipative current.

### Key planning details

- The good-conductor criterion is $\sigma/(\omega\epsilon')\gg1$.
- Conduction current dominates displacement current.
- The propagation constant reduces to $jk=(1+j)\sqrt{\pi f\mu\sigma}$.
- The attenuation and phase constants are equal.
- Both constants scale as $\sqrt{f\mu\sigma}$.
- Electric field and conduction current decay exponentially with depth.
- Inside the conductor, $\mathbf{J}=\sigma\mathbf{E}$ because displacement current is negligible.
- Dissipative conductor fields account for resistive loss in transmission lines.

### Source coverage

- Page 401 defines a good conductor by $\sigma/(\omega\epsilon')\gg1$.
- The nichrome example estimates this ratio as about $2\times10^8$ at 100 MHz.
- Equation (78) derives $jk=(1+j)\sqrt{\pi f\mu\sigma}$.
- Equation (79) gives $\alpha=\beta=\sqrt{\pi f\mu\sigma}$.
- Equation (80) gives the attenuating and phase-delayed electric field inside the conductor.
- Equation (81) gives $J_x=\sigma E_x$ with the same depth and phase dependence.
