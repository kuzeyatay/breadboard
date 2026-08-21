---
title: "1.54 Electric Flux Through an Oriented Surface"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 65", "Figure 3.2"]
related: ["gauss-law-in-integral-form", "choosing-gaussian-surfaces-by-symmetry", "divergence-as-local-flux-outflow"]
---

# 1.54 Electric Flux Through an Oriented Surface

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 65, Figure 3.2

Electric flux through a surface is determined by the component of electric flux density normal to that surface. An incremental surface is represented by the vector $d\mathbf{S}$, whose magnitude is the differential area $dS$ and whose direction is normal to the surface. For a closed surface, the outward normal resolves the otherwise possible choice between two normal directions. If $\mathbf{D}_S$ makes an angle $\theta$ with the oriented surface element, the incremental flux is the dot product $d\Psi=\mathbf{D}_S\cdot d\mathbf{S}=D_S\cos\theta\,dS$. Thus a normal field contributes its full magnitude, a tangential field contributes zero, and a field directed inward contributes negative outward flux. Summing the contributions over a closed surface gives $\Psi=\oint_S\mathbf{D}_S\cdot d\mathbf{S}$. This is a double integral because each surface element contains two coordinate differentials. The precise area element depends on the coordinate system, such as $dx\,dy$ in rectangular coordinates, $\rho\,d\phi\,d\rho$ on an appropriate cylindrical-coordinate surface, or $r^2\sin\theta\,d\theta\,d\phi$ on a sphere.

## Page-Grounded Details

#### Page 65

Figure 3.2 The electric flux density $\mathbf{D}_{S}$ at $P$ arising from charge $Q$. The total flux passing through $\Delta\mathbf{S}$ is $\mathbf{D}_{S}\cdot\Delta\mathbf{S}$.

vector quantity. The only unique direction that may be associated with $\Delta\mathbf{S}$ is the direc-tion of the normal to that plane which is tangent to the surface at the point in question. There are, of course, two such normals, and the ambiguity is removed by specifying the outward normal whenever the surface is closed; "outward" has a specific meaning.

At any point $P$, consider an incremental element of surface $\Delta S$ and let $\mathbf{D}_{S}$ make an angle $\theta$ with $\Delta\mathbf{S}$, as shown in Figure 3.2. The flux crossing $\Delta S$ is then the product of the normal component of $\mathbf{D}_{S}$ and $\Delta\mathbf{S}$,
$$
\Delta\Psi=\text{flux crossing }\Delta S=D_{S,\text{norm}}\Delta S=D_{S}\cos\theta\,\Delta S=\mathbf{D}_{S}\cdot\Delta\mathbf{S}
$$
where we are able to apply the definition of the dot product developed in Chapter 1.

The total flux passing through the closed surface is obtained by adding the dif-ferential contributions crossing each sur

[Truncated for analysis]

## Core Ideas

- The vector area element points normal to the local tangent plane.
- The outward normal is used for every element of a closed surface.
- Incremental flux is $d\Psi=\mathbf{D}_S\cdot d\mathbf{S}$.
- Only the normal component of electric flux density crosses a surface.
- A tangential field produces zero flux through that surface element.
- The circle on $\oint$ denotes integration over a closed surface.
- A surface integral is a double integral even when written with one integral sign.

## Source Anchors

- Page 65 defines $\Delta\Psi=D_{S,\mathrm{norm}}\Delta S=D_S\cos\theta\,\Delta S=\mathbf{D}_S\cdot\Delta\mathbf{S}$.
- Page 65 states that the outward normal removes the directional ambiguity for a closed surface.
- Page 65 gives the total flux as $\Psi=\oint_{\mathrm{closed}}\mathbf{D}_S\cdot d\mathbf{S}$.
- Page 65 lists representative surface differentials including $dx\,dy$ and $r^2\sin\theta\,d\theta\,d\phi$.
- S1.P65.F1 shows $\mathbf{D}_S$ at point $P$, the oriented area $\Delta\mathbf{S}$, and the flux $\mathbf{D}_S\cdot\Delta\mathbf{S}$.

## Related Pages

- [[gauss-law-in-integral-form|Gauss's Law in Integral Form]]
- [[choosing-gaussian-surfaces-by-symmetry|Choosing Gaussian Surfaces by Symmetry]]
- [[divergence-as-local-flux-outflow|Divergence as Local Flux Outflow]]

## Concept Dependencies

- part-of: [[gauss-law-in-integral-form|Gauss's Law in Integral Form]]
- enables: [[divergence-as-local-flux-outflow|Divergence as Local Flux Outflow]]
