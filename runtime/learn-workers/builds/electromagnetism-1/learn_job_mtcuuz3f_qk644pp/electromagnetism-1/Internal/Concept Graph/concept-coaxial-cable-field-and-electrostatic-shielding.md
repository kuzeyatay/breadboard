---
title: "Coaxial Cable Field and Electrostatic Shielding"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "coaxial-cable-field-and-electrostatic-shielding"
locations: ["Page 70", "Page 71", "Page 72", "Figure 3.5"]
related: ["infinite-uniform-line-charge-field", "choosing-gaussian-surfaces-by-symmetry", "fields-from-layered-charge-distributions", "gauss-law-in-integral-form", "coaxial-cable-charge-and-field-calculation"]
---

## ConceptNode: Coaxial Cable Field and Electrostatic Shielding

Planning node for [[coaxial-cable-field-and-electrostatic-shielding|1.59 Coaxial Cable Field and Electrostatic Shielding]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 70, Page 71, Page 72, Figure 3.5

A coaxial cable consists of two coaxial cylindrical conductors with inner radius $a$ and outer radius $b$. If the outer surface of the inner conductor carries uniform surface charge density $\rho_S$, cylindrical symmetry requires $\mathbf{D}=D_\rho(\rho)\mathbf{a}_\rho$. For a gaussian cylinder with $a<\rho<b$, the enclosed charge over length $L$ is $Q=2\pi aL\rho_S$. Gauss's law gives $D_\rho(2\pi\rho L)=Q$, so $\mathbf{D}=a\rho_S\mathbf{a}_\rho/\rho$. Defining line charge density as $\rho_L=2\pi a\rho_S$ gives the equivalent form $\mathbf{D}=\rho_L\mathbf{a}_\rho/(2\pi\rho)$. Equal and opposite total charge appears on the inner surface of the outer conductor, which leads to $\rho_{S,\mathrm{outer}}=-(a/b)\rho_{S,\mathrm{inner}}$. A gaussian surface outside the outer conductor encloses zero net charge, so the external field is zero. The field is also zero inside the inner conductor. The ideal result applies approximately to a finite open cable when its length is much greater than its outer radius and end effects are negligible.

### Key planning details

- Between conductors, $\mathbf{D}=a\rho_S\mathbf{a}_\rho/\rho$.
- The inner conductor line charge density is $\rho_L=2\pi a\rho_S$.
- The field between conductors matches the infinite line-charge form.
- The outer conductor's inner surface carries equal and opposite total charge.
- Surface densities satisfy $\rho_{S,\mathrm{outer}}=-(a/b)\rho_{S,\mathrm{inner}}$.
- The field is zero for $\rho<a$ and for $\rho>b$ in the ideal model.
- Zero external field demonstrates electrostatic shielding by the outer conductor.
- Finite-length results require negligible end effects.

### Source coverage

- Pages 70 and 71 derive $Q=2\pi aL\rho_S$ and $\mathbf{D}=a\rho_S\mathbf{a}_\rho/\rho$ for $a<\rho<b$.
- Page 71 rewrites the field using $\rho_L=2\pi a\rho_S$.
- Page 71 derives $\rho_{S,\mathrm{outer}}=-(a/b)\rho_{S,\mathrm{inner}}$.
- Pages 71 and 72 show that the field is zero outside the outer conductor and inside the center conductor.
- S1.P71.F1 identifies the coaxial geometry and the field $D_\rho=a\rho_S/\rho$.
- Page 72 states that the finite-length approximation is valid when $L$ is many times greater than $b$.
