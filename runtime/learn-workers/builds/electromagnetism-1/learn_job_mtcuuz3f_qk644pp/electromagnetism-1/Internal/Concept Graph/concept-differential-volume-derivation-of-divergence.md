---
title: "Differential-Volume Derivation of Divergence"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "differential-volume-derivation-of-divergence"
locations: ["Page 73", "Page 74", "Page 75", "Figure 3.6", "Example 3.3"]
related: ["divergence-as-local-flux-outflow", "maxwells-first-equation", "divergence-in-coordinate-systems", "divergence-theorem", "gauss-law-in-integral-form"]
---

## ConceptNode: Differential-Volume Derivation of Divergence

Planning node for [[differential-volume-derivation-of-divergence|1.62 Differential-Volume Derivation of Divergence]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 73, Page 74, Page 75, Figure 3.6, Example 3.3

To analyze fields without global symmetry, the text applies Gauss's law to a very small rectangular box centered at a point $P$. The box has side lengths $\Delta x$, $\Delta y$, and $\Delta z$. The field on each face is approximated using the constant and first-derivative terms of a Taylor expansion. On the front and back faces, for example, $D_x$ is approximated by $D_{x0}\pm(\Delta x/2)(\partial D_x/\partial x)$. Because the outward normals on opposite faces have opposite directions, the constant terms cancel when their fluxes are added. The remaining net flux through the pair is $(\partial D_x/\partial x)\Delta x\Delta y\Delta z$. Repeating this for the other two face pairs produces analogous terms involving $D_y$ and $D_z$. The total outward flux is therefore approximately $[\partial D_x/\partial x+\partial D_y/\partial y+\partial D_z/\partial z]\Delta v$, where $\Delta v=\Delta x\Delta y\Delta z$. This derivation reveals that local changes in each matching field component determine the net flux from a small volume.

### Key planning details

- Use a small rectangular gaussian box centered at the evaluation point.
- Break the closed-surface integral into six face integrals.
- Use outward normals with opposite signs on opposing faces.
- Approximate face values with first-order Taylor expansions.
- Opposite-face constant field terms cancel.
- The front and back pair contributes $(\partial D_x/\partial x)\Delta v$.
- The other pairs contribute $(\partial D_y/\partial y)\Delta v$ and $(\partial D_z/\partial z)\Delta v$.
- The approximation becomes exact in the zero-volume limit.

### Source coverage

- Page 73 introduces a small box of dimensions $\Delta x$, $\Delta y$, and $\Delta z$ centered at $P$.
- Pages 73 and 74 approximate front and back values using $D_{x0}\pm(\Delta x/2)(\partial D_x/\partial x)$.
- Page 75 combines opposite-face fluxes to obtain one derivative term per coordinate direction.
- Page 75 gives $Q=[\partial D_x/\partial x+\partial D_y/\partial y+\partial D_z/\partial z]\Delta v$.
- S1.P74.F1 depicts the differential gaussian surface and the field variation around point $P$.
- Example 3.3 on Page 75 estimates $2$ nC in a volume of $10^{-9}\,\mathrm{m^3}$ at the origin.
