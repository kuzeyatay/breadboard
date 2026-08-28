---
title: "Free-Space Relationship Between Electric Flux Density and Electric Field"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "free-space-relationship-between-electric-flux-density-and-electric-field"
locations: ["Page 63", "Page 64", "Section: 3.1.2 Electric Flux Density"]
related: ["electric-flux-density-from-charge", "electric-field-integral-for-a-volume-charge-distribution", "charge-distribution-dimensionality", "gausss-law-for-closed-surfaces"]
---

## ConceptNode: Free-Space Relationship Between Electric Flux Density and Electric Field

Planning node for [[free-space-relationship-between-electric-flux-density-and-electric-field|1.52 Free-Space Relationship Between Electric Flux Density and Electric Field]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 63, Page 64, Section: 3.1.2 Electric Flux Density

For a point charge in free space, the electric field intensity and electric flux density have identical direction and inverse-square geometry, but their magnitudes differ by the free-space permittivity $\epsilon_0$. Comparing their point-charge formulas gives $\mathbf{D}=\epsilon_0\mathbf{E}$. Superposition extends this relation to any free-space charge configuration. The volume integral for $\mathbf{D}$ has the same source density, separation, and direction factors as the corresponding integral for $\mathbf{E}$, but it does not contain $\epsilon_0$ in the denominator. This makes many $\mathbf{D}$ expressions algebraically simpler. The source cautions that the free-space relation does not directly apply inside a general dielectric, even though the point-charge flux-density expression remains tied to source charge. Later material must therefore supply a more general medium-dependent relation between $\mathbf{D}$ and $\mathbf{E}$.

### Key planning details

- In free space, $\mathbf{D}$ and $\mathbf{E}$ are parallel.
- Their free-space relation is $\mathbf{D}=\epsilon_0\mathbf{E}$.
- The relation applies to any free-space charge configuration by superposition.
- The $\mathbf{D}$ source integral omits the factor $\epsilon_0$.
- The meanings of $\mathbf{D}$ and $\mathbf{E}$ remain distinct despite proportionality.
- A more general constitutive relation is required in dielectric media.

### Source coverage

- The point-charge field is $$\mathbf{E}=\frac{Q}{4\pi\epsilon_0r^2}\mathbf{a}_r.$$
- Equation (2): $$\mathbf{D}=\epsilon_0\mathbf{E}\qquad\text{(free space only)}.$$
- Equation (3) gives the free-space volume integral for $\mathbf{E}$.
- Equation (4): $$\mathbf{D}=\int_{\mathrm{vol}}\frac{\rho_vdv}{4\pi R^2}\mathbf{a}_R.$$
- The source states that Equation (2) is valid for any free-space charge configuration.
- Drill D3.2 asks for $\mathbf{D}$ at one point due to a point charge, a line charge, and a charged plane.
