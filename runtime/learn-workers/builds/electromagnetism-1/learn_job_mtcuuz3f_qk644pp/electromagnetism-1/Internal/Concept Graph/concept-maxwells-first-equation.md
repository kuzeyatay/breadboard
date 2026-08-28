---
title: "Maxwell's First Equation"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "maxwells-first-equation"
locations: ["Page 76", "Page 78", "Page 79"]
related: ["gauss-law-in-integral-form", "differential-volume-derivation-of-divergence", "divergence-as-local-flux-outflow", "divergence-theorem", "spherical-gaussian-surface-for-a-point-charge"]
---

## ConceptNode: Maxwell's First Equation

Planning node for [[maxwells-first-equation|1.65 Maxwell's First Equation]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 76, Page 78, Page 79

Taking the differential-volume limit of Gauss's law identifies the local divergence of electric flux density with volume charge density. The result is $\operatorname{div}\mathbf{D}=\rho_v$, or equivalently $\nabla\cdot\mathbf{D}=\rho_v$. This is the point form and differential-equation form of Gauss's law. It states that the electric flux leaving a vanishingly small volume per unit volume equals the charge density at that point. The integral form describes the total flux and charge over a finite region, while the point form describes their local relationship. Applied to the point-charge field $\mathbf{D}=Q\mathbf{a}_r/(4\pi r^2)$, the spherical divergence formula gives zero for every $r\neq0$ because $r^2D_r$ is constant. The charge density is therefore zero away from the origin and singular at the origin, where the point charge is located. This example is an important warning: a field can have nonzero flux through an enclosing surface even though its ordinary divergence is zero at every nonsingular point inside the surrounding region.

### Key planning details

- Maxwell's first equation is $\nabla\cdot\mathbf{D}=\rho_v$.
- It is the point form of Gauss's law.
- It is also the differential-equation form of Gauss's law.
- The integral form applies to a finite closed surface and enclosed volume.
- The point form relates local flux outflow to local volume charge density.
- For a point charge, $\nabla\cdot\mathbf{D}=0$ when $r\neq0$.
- The point charge produces a singular charge density at the origin.

### Source coverage

- Page 76 identifies the zero-volume flux ratio with $\rho_v$.
- Page 78 states $\operatorname{div}\mathbf{D}=\rho_v$ as Maxwell's first equation.
- Page 78 describes the equation as both point form and differential-equation form.
- Page 79 applies spherical divergence to $\mathbf{D}=Q\mathbf{a}_r/(4\pi r^2)$.
- Page 79 obtains zero divergence for $r\neq0$ and states that charge density is infinite at the origin.
- Problem D3.8 on Page 79 asks learners to determine $\rho_v$ from given $\mathbf{D}$ fields.
