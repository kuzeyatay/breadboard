---
title: "1.53 Gauss's Law for Closed Surfaces"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 64", "Section: 3.2 Gauss's Law"]
related: ["faraday-displacement-flux", "electric-flux-density-from-charge", "free-space-relationship-between-electric-flux-density-and-electric-field"]
---

# 1.53 Gauss's Law for Closed Surfaces

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 64, Section: 3.2 Gauss's Law

Gauss's law generalizes Faraday's concentric-sphere result beyond spherical conductors and symmetric charge arrangements. The total electric flux through any closed surface equals the total charge enclosed by that surface. The enclosing surface can be a real boundary or an imagined Gaussian surface of arbitrary shape. Changing the shape of the enclosed conductor or the surrounding closed surface changes how flux density varies from point to point, but it does not change the total outward flux associated with a fixed enclosed charge. To express the law mathematically, the source begins constructing an oriented differential surface element. Its area gives the element magnitude, while its normal direction specifies orientation. The local surface value $\mathbf{D}_S$ generally varies in both magnitude and direction, so the total flux must account for the normal component across every element of the closed surface.

## Page-Grounded Details

#### Page 64

D3.2. Calculate D in rectangular coordinates at point P(2,-3,6) produced by: (a) a point charge $Q_{A}$ = 55 mC at Q(-2,3,-6); (b) a uniform line charge $\rho_{LB}$ = 20 mC/m on the x axis; (c) a uniform surface charge density $\rho_{SC}$ = 120 $\mu C/m^{2}$ on the plane z = -5 m.

Ans. (a) $6.38a_{x} - 9.57a_{y} + 19.14a_{z} \ \mu C/m^{2}$; (b) $-212a_{y} + 424a_{z} \ \mu C/m^{2}$; (c) $60a_{z} \ \mu C/m^{2}$

#### 3.2 GAUSS'S LAW

The results of Faraday's experiments with the concentric spheres could be summed up as an experimental law by stating that the electric flux passing through any imaginary spherical surface lying between the two conducting spheres is equal to the charge enclosed within that imaginary surface. This enclosed charge is distributed on the surface of the inner sphere, or it might be concentrated as a point charge at the center of the imaginary sphere. However, because one coulomb of electric flux is produced by one coulomb of charge, the inner conductor might just as well have been a cube or a brass door key and the total induced charge on the outer sphere would still be the same. Certainly the flux density would change from its previous symmetr

[Truncated for analysis]

## Core Ideas

- Total electric flux through a closed surface equals enclosed charge.
- The closed surface may be physical or purely imaginary.
- The law does not require a spherical surface.
- Surface shape affects local flux density but not total enclosed-charge flux.
- The flux integral requires an oriented differential surface element.
- Only the component of $\mathbf{D}$ normal to each surface element contributes to crossing flux.

## Source Anchors

- The source states: electric flux passing through any closed surface is equal to the total charge enclosed by that surface.
- A charged object of arbitrary shape inside a surrounding closed conductor still produces total flux equal to its charge.
- The text uses a cube, a brass door key, and a closed soup can to emphasize shape independence.
- A charge $+Q$ on an inner conductor induces $-Q$ on the enclosing conductor in the generalized Faraday argument.
- Source figure S1.P64.F1, Figure 3.2, is introduced as a cloud of point charges surrounded by a closed surface of arbitrary shape.
- The local surface field is denoted $\mathbf{D}_S$ and may vary across the surface.
- An incremental surface element requires both area magnitude $\Delta S$ and spatial orientation.

## Related Pages

- [[faraday-displacement-flux|Faraday Displacement Flux]]
- [[electric-flux-density-from-charge|Electric Flux Density from Charge]]
- [[free-space-relationship-between-electric-flux-density-and-electric-field|Free-Space Relationship Between Electric Flux Density and Electric Field]]

## Concept Dependencies

- derives-from: [[faraday-displacement-flux|Faraday Displacement Flux]]
- depends-on: [[electric-flux-density-from-charge|Electric Flux Density from Charge]]
