---
title: "Permanent Magnetization and Equivalent Magnetic Sources"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "permanent-magnetization-and-equivalent-magnetic-sources"
locations: ["Page 290"]
related: ["magnetization-magnetic-materials-and-bound-currents", "maxwell-equations-and-supporting-constitutive-relations"]
---

## ConceptNode: Permanent Magnetization and Equivalent Magnetic Sources

Planning node for [[permanent-magnetization-and-equivalent-magnetic-sources|1.140 Permanent Magnetization and Equivalent Magnetic Sources]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 290

Problem 8.45 develops potential equations for regions containing permanent magnetization but no free current. Starting with the scalar magnetic potential definition $\mathbf{H}=-\nabla V_m$ and the material relation involving magnetization, the problem introduces an equivalent magnetic charge density $$\rho_m=-\mu_0\nabla\cdot\mathbf{M}.$$ The scalar potential then satisfies the Poisson equation $$\nabla^2V_m=-\frac{\rho_m}{\mu_0}.$$ If $\mathbf{M}$ is uniform, its divergence vanishes within the volume, so there is no equivalent volume magnetic charge there, although boundaries may still require separate treatment. A complementary vector-potential description begins with $\mathbf{B}=\nabla\times\mathbf{A}$. In a zero-free-current region with permanent magnetization, the source asks for $$\nabla\times\nabla\times\mathbf{A}=\mu_0\mathbf{J}_{eq},$$ where $$\mathbf{J}_{eq}=\nabla\times\mathbf{M}.$$ These two representations connect permanent magnets to mathematically equivalent source models: divergence of magnetization acts like a magnetic-charge source for scalar potential, while curl of magnetization acts like an equivalent current source for vector potential.

### Key planning details

- The scalar magnetic potential is defined by $\mathbf{H}=-\nabla V_m$ in the stated zero-current setting.
- Equivalent magnetic charge density is $\rho_m=-\mu_0\nabla\cdot\mathbf{M}$.
- The magnetic scalar potential satisfies $\nabla^2V_m=-\rho_m/\mu_0$.
- Uniform volume magnetization has zero divergence within the material.
- The vector magnetic potential is defined by $\mathbf{B}=\nabla\times\mathbf{A}$.
- Equivalent magnetization current is $\mathbf{J}_{eq}=\nabla\times\mathbf{M}$.
- Scalar and vector potential models expose complementary source properties of magnetization.

### Source coverage

- Problem 8.45(a) begins with $\mathbf{H}=-\nabla V_m$.
- The stated Poisson equation is $\nabla^2V_m=-\rho_m/\mu_0$.
- The equivalent magnetic charge density is defined as $\rho_m=-\mu_0\nabla\cdot\mathbf{M}$.
- Problem 8.45 asks what occurs when $\mathbf{M}$ is uniform.
- Problem 8.45(b) begins with $\mathbf{B}=\nabla\times\mathbf{A}$.
- The equivalent current density is given as $\mathbf{J}_{eq}=\nabla\times\mathbf{M}$.
