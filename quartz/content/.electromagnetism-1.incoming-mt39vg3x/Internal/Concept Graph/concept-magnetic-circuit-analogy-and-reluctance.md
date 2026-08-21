---
title: "Magnetic Circuit Analogy and Reluctance"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "magnetic-circuit-analogy-and-reluctance"
locations: ["Page 269", "Page 270", "Page 271", "Section 8.8"]
related: ["linear-magnetic-constitive-relations", "air-core-toroid-circuit-calculation", "ferromagnetic-magnetization-and-hysteresis", "nonlinear-gapped-magnetic-circuit-analysis", "linear-magnetic-constitutive-relations"]
---

## ConceptNode: Magnetic Circuit Analogy and Reluctance

Planning node for [[magnetic-circuit-analogy-and-reluctance|1.124 Magnetic Circuit Analogy and Reluctance]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 269, Page 270, Page 271, Section 8.8

A magnetic circuit provides a lumped approximation analogous to a dc resistive circuit. Electric potential and magnetic scalar potential satisfy parallel gradient relations, $\mathbf{E}=-\nabla V$ and $\mathbf{H}=-\nabla V_m$. In this context $V_m$ is called magnetomotive force, or mmf, and is measured in amperes or ampere-turns. The constitutive analog of $\mathbf{J}=\sigma\mathbf{E}$ is $\mathbf{B}=\mu\mathbf{H}$, while current $I=\int_S\mathbf{J}\cdot d\mathbf{S}$ corresponds to magnetic flux $\Phi=\int_S\mathbf{B}\cdot d\mathbf{S}$. Resistance satisfies $V=IR$, and reluctance satisfies $V_m=\Phi\mathcal{R}$. For a uniform linear material of length $d$ and area $S$, $R=d/(\sigma S)$ and $\mathcal{R}=d/(\mu S)$. A coil linking the magnetic path supplies the source mmf, with $\oint\mathbf{H}\cdot d\mathbf{L}=NI$. Unlike a voltage source inserted between two circuit terminals, the coil surrounds or links the magnetic circuit. The analogy is exact enough to organize calculations, but ferromagnetic nonlinearity, leakage, and fringing limit the simple lumped model.

### Key planning details

- Magnetomotive force is the magnetic analog of electric potential difference.
- The field-potential relation is $\mathbf{H}=-\nabla V_m$ in current-free regions.
- Magnetic flux is $\Phi=\int_S\mathbf{B}\cdot d\mathbf{S}$.
- Reluctance is defined by $V_m=\Phi\mathcal{R}$.
- Uniform linear sections have $\mathcal{R}=d/(\mu S)$.
- Reluctance is measured in ampere-turns per weber.
- An $N$-turn coil carrying current $I$ supplies mmf $NI$.
- Ferromagnetic sections generally make the circuit nonlinear.

### Source coverage

- Equations (38a) and (38b) compare $\mathbf{E}=-\nabla V$ with $\mathbf{H}=-\nabla V_m$.
- Equations (40a) and (40b) compare $\mathbf{J}=\sigma\mathbf{E}$ with $\mathbf{B}=\mu\mathbf{H}$.
- Equations (41a) and (41b) compare total current with total magnetic flux.
- Equations (42a) and (42b) compare $V=IR$ with $V_m=\Phi\mathcal{R}$.
- Equation (43b) gives $\mathcal{R}=d/(\mu S)$.
- Equation (44) gives $\oint\mathbf{H}\cdot d\mathbf{L}=NI$.
