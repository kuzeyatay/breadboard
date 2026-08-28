---
title: "Poynting Vector and Electromagnetic Energy Conservation"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "poynting-vector-and-electromagnetic-energy-conservation"
locations: ["Page 398", "Page 399", "Page 400"]
related: ["time-average-power-density-of-sinusoidal-waves", "lossless-dielectric-plane-wave-propagation", "good-conductor-intrinsic-impedance-and-power-density", "skin-effect-resistance"]
---

## ConceptNode: Poynting Vector and Electromagnetic Energy Conservation

Planning node for [[poynting-vector-and-electromagnetic-energy-conservation|1.227 Poynting Vector and Electromagnetic Energy Conservation]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 398, Page 399, Page 400

Poynting's theorem is derived as an electromagnetic power-conservation law. The derivation begins with the conductive-medium Maxwell equation $\nabla\times\mathbf{H}=\mathbf{J}+\partial\mathbf{D}/\partial t$ and takes its scalar product with $\mathbf{E}$. The vector identity $\nabla\cdot(\mathbf{E}\times\mathbf{H})=-\mathbf{E}\cdot(\nabla\times\mathbf{H})+\mathbf{H}\cdot(\nabla\times\mathbf{E})$ introduces a divergence term. Substitution of Faraday's law, $\nabla\times\mathbf{E}=-\partial\mathbf{B}/\partial t$, produces a local balance between outward field power, ohmic dissipation, and changing electric and magnetic energy. The electric and magnetic terms are rewritten as time derivatives of the energy densities $\mathbf{D}\cdot\mathbf{E}/2$ and $\mathbf{B}\cdot\mathbf{H}/2$. Integration over a volume and application of the divergence theorem yield the integral Poynting theorem. The surface integral of $\mathbf{E}\times\mathbf{H}$ is the total outward power, while the volume terms represent dissipated power and rates of increase of stored energy. The Poynting vector $\mathbf{S}=\mathbf{E}\times\mathbf{H}$ has units of $\mathrm{W/m^2}$ and points in the instantaneous power-flow direction.

### Key planning details

- The derivation begins with Ampere-Maxwell law in a conductive medium.
- A vector identity converts field curls into the divergence of $\mathbf{E}\times\mathbf{H}$.
- Faraday's law supplies the magnetic-energy term.
- Electric energy density is $\mathbf{D}\cdot\mathbf{E}/2$.
- Magnetic energy density is $\mathbf{B}\cdot\mathbf{H}/2$.
- The term $\mathbf{J}\cdot\mathbf{E}$ represents instantaneous ohmic power density.
- The Poynting vector is $\mathbf{S}=\mathbf{E}\times\mathbf{H}$ in $\mathrm{W/m^2}$.
- A closed-surface integral of $\mathbf{S}$ gives total outward electromagnetic power.

### Source coverage

- Equations (63) through (67) derive the local field-power balance from Maxwell's curl equations.
- Equations (68a) and (68b) identify the electric and magnetic stored-energy derivatives.
- Equation (69) is the differential form of the complete power balance.
- Equation (70) is the volume-integrated Poynting theorem after applying the divergence theorem.
- Equation (71) identifies $\oint(\mathbf{E}\times\mathbf{H})\cdot d\mathbf{S}$ as total outward power.
- Equation (72) defines $\mathbf{S}=\mathbf{E}\times\mathbf{H}$.
