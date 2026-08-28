---
title: "Divergence in Coordinate Systems"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "divergence-in-coordinate-systems"
locations: ["Page 77", "Page 78", "Page 79", "Page 85"]
related: ["divergence-as-local-flux-outflow", "maxwells-first-equation", "del-operator-and-divergence-notation", "fields-from-layered-charge-distributions", "gauss-law-and-divergence-problem-solving-methods"]
---

## ConceptNode: Divergence in Coordinate Systems

Planning node for [[divergence-in-coordinate-systems|1.64 Divergence in Coordinate Systems]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 77, Page 78, Page 79, Page 85

The explicit formula for divergence depends on the coordinate system because differential volumes and surface areas have different scale factors. In rectangular coordinates, $\operatorname{div}\mathbf{D}=\partial D_x/\partial x+\partial D_y/\partial y+\partial D_z/\partial z$. In cylindrical coordinates, the radial expansion of area introduces the factor $\rho$, giving $\operatorname{div}\mathbf{D}=(1/\rho)\partial(\rho D_\rho)/\partial\rho+(1/\rho)\partial D_\phi/\partial\phi+\partial D_z/\partial z$. In spherical coordinates, radial and angular area changes give $\operatorname{div}\mathbf{D}=(1/r^2)\partial(r^2D_r)/\partial r+[1/(r\sin\theta)]\partial(\sin\theta D_\theta)/\partial\theta+[1/(r\sin\theta)]\partial D_\phi/\partial\phi$. The correct formula must be selected before differentiating. One differentiates the component paired with each coordinate, including the geometric factors shown. Exercises ask for numerical divergence at points in all three systems and for volume charge density derived from specified fields, reinforcing that the coordinate-system formula is part of the calculation rather than an optional notation change.

### Key planning details

- Rectangular divergence is $\partial D_x/\partial x+\partial D_y/\partial y+\partial D_z/\partial z$.
- Cylindrical radial divergence uses $(1/\rho)\partial(\rho D_\rho)/\partial\rho$.
- Cylindrical azimuthal divergence uses $(1/\rho)\partial D_\phi/\partial\phi$.
- Spherical radial divergence uses $(1/r^2)\partial(r^2D_r)/\partial r$.
- Spherical polar divergence includes $\sin\theta$ inside the derivative.
- Coordinate scale factors must not be omitted.
- The result remains a scalar in every coordinate system.

### Source coverage

- Page 77 gives the rectangular-coordinate divergence formula.
- Page 77 gives the cylindrical-coordinate divergence formula.
- Page 77 gives the spherical-coordinate divergence formula.
- Problem D3.7 on Page 78 requires divergence calculations in rectangular, cylindrical, and spherical coordinates.
- Problem D3.8 on Page 79 asks for volume charge density from fields expressed in all three coordinate systems.
- Problem 3.16 on Page 85 asks for the charge density associated with a constant radial cylindrical flux density.
