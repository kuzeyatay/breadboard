---
title: "Divergence in Orthogonal Curvilinear Coordinates"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "divergence-in-orthogonal-curvilinear-coordinates"
locations: ["Page 570, Section A.2"]
related: ["orthogonal-curvilinear-coordinates-and-scale-factors", "gradient-curl-and-laplacian-in-curvilinear-coordinates", "vector-identities-for-electromagnetic-analysis"]
---

## ConceptNode: Divergence in Orthogonal Curvilinear Coordinates

Planning node for [[divergence-in-orthogonal-curvilinear-coordinates|1.344 Divergence in Orthogonal Curvilinear Coordinates]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 570, Section A.2

Divergence is derived by computing the net outward flux through the six faces of a differential curvilinear volume. For the pair of faces normal to $\mathbf{a}_u$, the area is $h_2h_3\,dv\,dw$, and the first-order difference between opposite-face fluxes produces $\frac{\partial}{\partial u}(h_2h_3D_u)\,du\,dv\,dw$. Cyclic permutations supply the corresponding $v$ and $w$ contributions. Dividing total outward flux by the differential volume $h_1h_2h_3\,du\,dv\,dw$ gives $$\nabla\cdot\mathbf{D}=\frac{1}{h_1h_2h_3}\left[\frac{\partial}{\partial u}(h_2h_3D_u)+\frac{\partial}{\partial v}(h_3h_1D_v)+\frac{\partial}{\partial w}(h_1h_2D_w)\right].$$ The metric factors appear because coordinate-face areas and volume vary with position. This formula is valid for any orthogonal coordinate system once its scale factors are known. Substituting rectangular, cylindrical, or spherical scale factors reproduces the familiar specialized divergence formulas. The derivation is directly grounded in flux per unit volume, preserving the physical interpretation of divergence as local source strength.

### Key planning details

- Divergence is net outward flux divided by differential volume.
- A face normal to $\mathbf{a}_u$ has area $h_2h_3\,dv\,dw$.
- Opposite-face subtraction produces a derivative of both the field component and metric area factor.
- The denominator is the volume factor $h_1h_2h_3$.
- The other component contributions follow by cyclic permutation.
- Known scale factors specialize the formula to common coordinate systems.

### Source coverage

- Page 570 derives the flux through the two faces normal to $\mathbf{a}_u$.
- The paired-face contribution is $\frac{\partial}{\partial u}(h_2h_3D_u)\,du\,dv\,dw$.
- The total flux includes analogous $v$ and $w$ terms.
- Equation (A.2) gives the full orthogonal-coordinate divergence formula.
- The derivation divides by $h_1h_2h_3\,du\,dv\,dw$.
