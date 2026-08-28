---
title: "Retarded Scalar and Vector Potentials"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "retarded-scalar-and-vector-potentials"
locations: ["Page 309", "Page 310", "Section 9.5: The Retarded Potentials", "Section: Developmental Problem D9.7"]
related: ["lorenz-gauge-and-potential-wave-equations", "static-scalar-and-vector-potentials", "potential-and-duality-problems", "distributed-versus-lumped-circuit-models"]
---

## ConceptNode: Retarded Scalar and Vector Potentials

Planning node for [[retarded-scalar-and-vector-potentials|1.155 Retarded Scalar and Vector Potentials]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 309, Page 310, Section 9.5: The Retarded Potentials, Section: Developmental Problem D9.7

Electromagnetic influence propagates through a homogeneous medium at finite speed $$v=\frac{1}{\sqrt{\mu\epsilon}},$$ so a potential observed at time $t$ depends on source values at an earlier time. For a source element at distance $R$, the retarded time is $$t'=t-\frac{R}{v}.$$ Brackets around a source quantity indicate that every occurrence of time in that source is replaced by $t'$. The retarded scalar and vector potentials are $$V=\int_{\mathrm{vol}}\frac{[\rho_v]}{4\pi\epsilon R}\,dv,$$ $$\mathbf{A}=\int_{\mathrm{vol}}\frac{\mu[\mathbf{J}]}{4\pi R}\,dv.$$ For example, if $\rho_v=e^{-r}\cos\omega t$, then $[\rho_v]=e^{-r}\cos[\omega(t-R/v)]$. These formulas are especially useful in radiation problems when charge and current distributions are known or can be approximated.

### Key planning details

- Propagation speed in a homogeneous medium is $v=1/\sqrt{\mu\epsilon}$.
- Free-space propagation speed is approximately $3\times10^8$ m/s.
- Retarded time is $t'=t-R/v$.
- Each source element is evaluated at a delay determined by its distance from the observation point.
- Fields are recovered from the retarded potentials using curl, gradient, and time differentiation.

### Source coverage

- Page 309 states the homogeneous-medium speed $v=1/\sqrt{\mu\epsilon}$.
- Equations (57) and (58) give the retarded scalar and vector potential integrals.
- Page 309 applies retardation to $\rho_v=e^{-r}\cos\omega t$.
- Page 310 states that known $\rho_v$ and $\mathbf{J}$ theoretically determine $V$ and $\mathbf{A}$, after which $\mathbf{E}$ and $\mathbf{B}$ follow.
- Developmental Problem D9.7 on Page 310 applies the retarded scalar potential to two oppositely signed sinusoidal point charges.
