---
title: "Magnetic Circuits, Reluctance, and Air Gaps"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "magnetic-circuits-reluctance-and-air-gaps"
locations: ["Page 287", "Page 288", "Page 289"]
related: ["magnetization-magnetic-materials-and-bound-currents", "magnetic-material-interfaces-and-spatially-varying-permeability", "self-inductance-mutual-inductance-and-flux-linkage", "magnetic-energy-and-transmission-line-inductance"]
---

## ConceptNode: Magnetic Circuits, Reluctance, and Air Gaps

Planning node for [[magnetic-circuits-reluctance-and-air-gaps|1.137 Magnetic Circuits, Reluctance, and Air Gaps]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 287, Page 288, Page 289

The magnetic-circuit problems treat cores, toroids, coils, and air gaps using magnetomotive force, reluctance, and flux. For a segment of approximately uniform field, reluctance is represented by $\mathcal{R}=\ell/(\mu A)$, where $\ell$ is magnetic path length, $\mu$ is permeability, and $A$ is cross-sectional area. The applied magnetomotive force is $NI$, and the circuit relation is analogous to a series network: flux is obtained from magnetomotive force divided by total reluctance. An air gap can dominate the total reluctance because its permeability is much lower than that of a ferromagnetic core, even when the gap is short. Composite cores require the correct series or parallel combination of flux paths and attention to different cross-sectional areas. The source contrasts infinite-permeability, fixed linear-permeability, and nonlinear silicon-steel models. It also asks students to start from Ampère's circuital law and integrate a position-dependent field over a rectangular core cross section, showing where a lumped magnetic-circuit approximation comes from and when a direct field calculation is more accurate.

### Key planning details

- Magnetomotive force is supplied by a winding as $NI$.
- A uniform magnetic segment has reluctance $\mathcal{R}=\ell/(\mu A)$.
- Flux is determined by magnetomotive force divided by total reluctance.
- Series magnetic segments carry common flux when leakage is neglected.
- A short air gap may dominate total reluctance because air has low permeability.
- Different core areas produce different flux densities for the same flux.
- Nonlinear magnetic materials require a magnetization curve rather than one fixed permeability.

### Source coverage

- S1.P288.F8.16 shows the core geometry for Problem 8.28, including outer legs, a central leg, a coil, and an optional $0.3\ \mathrm{mm}$ air gap.
- Problem 8.28 gives outer-leg areas of $1.6\ \mathrm{cm^2}$, central-leg area of $2.5\ \mathrm{cm^2}$, specified path lengths, and a 1200-turn coil carrying $12\ \mathrm{mA}$.
- Problem 8.29 asks for current using the silicon-steel magnetization curve after a linear estimate gives $B=0.666\ \mathrm{T}$.
- Problem 8.31 gives a toroidal magnetic path, an air gap, an applied mmf of $200\ \mathrm{A\cdot turn}$, and three material models.
- S1.P289.F8.17 supports Problem 8.35's cone-sphere current-return geometry and its energy and inductance calculations.
