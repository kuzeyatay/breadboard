---
title: "Air-Core Toroid Circuit Calculation"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "air-core-toroid-circuit-calculation"
locations: ["Page 271", "Page 272", "Section 8.8"]
related: ["magnetic-circuit-analogy-and-reluctance", "nonlinear-gapped-magnetic-circuit-analysis", "flux-linkage-and-self-inductance", "linear-magnetic-constitutive-relations"]
---

## ConceptNode: Air-Core Toroid Circuit Calculation

Planning node for [[air-core-toroid-circuit-calculation|1.125 Air-Core Toroid Circuit Calculation]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 271, Page 272, Section 8.8

The air-core toroid example demonstrates the complete magnetic-circuit procedure in a linear medium. The toroid has 500 turns, current 4 A, cross-sectional area $6\,\mathrm{cm}^2$, and mean radius 15 cm. Its coil supplies $NI=2000$ ampere-turns. Approximating the field as uniform along the mean path, the path length is $2\pi(0.15)$ m and the air-core reluctance is $\mathcal{R}=d/(\mu_0S)=1.25\times10^9$ A-turn/Wb. The flux is then $\Phi=V_m/\mathcal{R}=1.6\times10^{-6}$ Wb. Dividing by area gives $B=2.67\times10^{-3}$ T, and dividing by $\mu_0$ gives $H=2120$ A/m. Ampère's law provides an independent check: $H_\phi2\pi r=NI$, which gives the same value at the mean radius. The source reports that the uniform-field magnetic-circuit approximation differs by less than one quarter percent from a calculation using the exact flux distribution over the cross section.

### Key planning details

- The source mmf is calculated first as $NI$.
- The mean magnetic path length of a toroid is approximated by $2\pi r$.
- Air reluctance is computed with $\mu=\mu_0$.
- Flux follows from $\Phi=V_m/\mathcal{R}$.
- Flux density follows from $B=\Phi/S$ when it is approximately uniform.
- Field intensity follows from $H=B/\mu_0$.
- Ampère's law provides a direct validation of the circuit result.
- The mean-path approximation is highly accurate for the stated geometry.

### Source coverage

- The example uses $N=500$, $I=4$ A, $S=6\times10^{-4}$ m$^2$, and mean radius $r=0.15$ m.
- The calculated source mmf is 2000 A-turn.
- The calculated reluctance is $1.25\times10^9$ A-turn/Wb.
- The calculated flux is $1.6\times10^{-6}$ Wb.
- The calculated fields are $B=2.67\times10^{-3}$ T and $H=2120$ A/m.
- The direct check $H_\phi=NI/(2\pi r)$ also gives 2120 A/m.
