---
title: "Electric Flux Through an Oriented Surface"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "electric-flux-through-an-oriented-surface"
locations: ["Page 65", "Figure 3.2"]
related: ["gauss-law-in-integral-form", "choosing-gaussian-surfaces-by-symmetry", "divergence-as-local-flux-outflow"]
---

## ConceptNode: Electric Flux Through an Oriented Surface

Planning node for [[electric-flux-through-an-oriented-surface|1.54 Electric Flux Through an Oriented Surface]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 65, Figure 3.2

Electric flux through a surface is determined by the component of electric flux density normal to that surface. An incremental surface is represented by the vector $d\mathbf{S}$, whose magnitude is the differential area $dS$ and whose direction is normal to the surface. For a closed surface, the outward normal resolves the otherwise possible choice between two normal directions. If $\mathbf{D}_S$ makes an angle $\theta$ with the oriented surface element, the incremental flux is the dot product $d\Psi=\mathbf{D}_S\cdot d\mathbf{S}=D_S\cos\theta\,dS$. Thus a normal field contributes its full magnitude, a tangential field contributes zero, and a field directed inward contributes negative outward flux. Summing the contributions over a closed surface gives $\Psi=\oint_S\mathbf{D}_S\cdot d\mathbf{S}$. This is a double integral because each surface element contains two coordinate differentials. The precise area element depends on the coordinate system, such as $dx\,dy$ in rectangular coordinates, $\rho\,d\phi\,d\rho$ on an appropriate cylindrical-coordinate surface, or $r^2\sin\theta\,d\theta\,d\phi$ on a sphere.

### Key planning details

- The vector area element points normal to the local tangent plane.
- The outward normal is used for every element of a closed surface.
- Incremental flux is $d\Psi=\mathbf{D}_S\cdot d\mathbf{S}$.
- Only the normal component of electric flux density crosses a surface.
- A tangential field produces zero flux through that surface element.
- The circle on $\oint$ denotes integration over a closed surface.
- A surface integral is a double integral even when written with one integral sign.

### Source coverage

- Page 65 defines $\Delta\Psi=D_{S,\mathrm{norm}}\Delta S=D_S\cos\theta\,\Delta S=\mathbf{D}_S\cdot\Delta\mathbf{S}$.
- Page 65 states that the outward normal removes the directional ambiguity for a closed surface.
- Page 65 gives the total flux as $\Psi=\oint_{\mathrm{closed}}\mathbf{D}_S\cdot d\mathbf{S}$.
- Page 65 lists representative surface differentials including $dx\,dy$ and $r^2\sin\theta\,d\theta\,d\phi$.
- S1.P65.F1 shows $\mathbf{D}_S$ at point $P$, the oriented area $\Delta\mathbf{S}$, and the flux $\mathbf{D}_S\cdot\Delta\mathbf{S}$.
