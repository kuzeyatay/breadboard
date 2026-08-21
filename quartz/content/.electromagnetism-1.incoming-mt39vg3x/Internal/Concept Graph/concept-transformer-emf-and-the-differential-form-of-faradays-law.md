---
title: "Transformer EMF and the Differential Form of Faraday's Law"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "transformer-emf-and-the-differential-form-of-faradays-law"
locations: ["Page 293", "Page 294", "Page 295"]
related: ["faraday-induction-flux-linkage-and-lenzs-law", "motional-emf-and-moving-conductors", "maxwell-equations-and-supporting-constitutive-relations"]
---

## ConceptNode: Transformer EMF and the Differential Form of Faraday's Law

Planning node for [[transformer-emf-and-the-differential-form-of-faradays-law|1.143 Transformer EMF and the Differential Form of Faraday's Law]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 293, Page 294, Page 295

For a stationary closed path, motion does not contribute to the induced voltage, so only the explicit time dependence of magnetic flux density remains. Faraday's law becomes $$\oint\mathbf{E}\cdot d\mathbf{L}=-\int_S\frac{\partial\mathbf{B}}{\partial t}\cdot d\mathbf{S}.$$ Applying Stokes' theorem to the closed line integral converts this integral relationship into the point equation $$\nabla\times\mathbf{E}=-\frac{\partial\mathbf{B}}{\partial t}.$$ This is one of Maxwell's equations and states locally that a time-changing magnetic flux density produces a circulating electric field. If $\mathbf{B}$ has no time dependence, the equations reduce to the electrostatic results $\oint\mathbf{E}\cdot d\mathbf{L}=0$ and $\nabla\times\mathbf{E}=0$. The cylindrical example uses $\mathbf{B}=B_0e^{kt}\mathbf{a}_z$ within $\rho<b$. Symmetry makes $E_\phi$ constant around a circular path, and the flux law gives $$\mathbf{E}=-\frac{1}{2}kB_0e^{kt}\rho\mathbf{a}_\phi.$$ The same result follows from evaluating the cylindrical-coordinate curl equation, demonstrating agreement between integral and differential methods.

### Key planning details

- A stationary path isolates the transformer-emf contribution.
- Transformer emf is $-\int_S(\partial\mathbf{B}/\partial t)\cdot d\mathbf{S}$.
- Stokes' theorem converts the integral law into $\nabla\times\mathbf{E}=-\partial\mathbf{B}/\partial t$.
- A changing magnetic field produces a circulating, generally nonconservative electric field.
- The static limit restores zero closed-path electric-field circulation.
- Cylindrical symmetry reduces the induced field to an azimuthal component.
- Integral and point-form calculations must give the same induced field.

### Source coverage

- Equation (5) gives $\oint\mathbf{E}\cdot d\mathbf{L}=-\int_S(\partial\mathbf{B}/\partial t)\cdot d\mathbf{S}$ for a stationary path.
- Equation (6) gives $\nabla\times\mathbf{E}=-\partial\mathbf{B}/\partial t$.
- Page 294 states the electrostatic limits $\oint\mathbf{E}\cdot d\mathbf{L}=0$ and $\nabla\times\mathbf{E}=0$.
- Equation (7) specifies $\mathbf{B}=B_0e^{kt}\mathbf{a}_z$ for $\rho<b$.
- Equation (8) gives $\mathbf{E}=-(1/2)kB_0e^{kt}\rho\mathbf{a}_\phi$.
- The induced negative-$\mathbf{a}_\phi$ current would produce negative-$\mathbf{a}_z$ flux opposing the applied flux increase.
