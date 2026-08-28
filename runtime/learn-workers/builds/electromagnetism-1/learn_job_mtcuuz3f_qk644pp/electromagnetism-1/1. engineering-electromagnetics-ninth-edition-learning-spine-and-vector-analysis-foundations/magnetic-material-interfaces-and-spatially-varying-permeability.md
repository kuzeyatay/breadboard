---
title: "1.136 Magnetic Material Interfaces and Spatially Varying Permeability"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 287"]
related: ["magnetization-magnetic-materials-and-bound-currents", "magnetic-circuits-reluctance-and-air-gaps", "maxwell-equations-in-integral-form-and-field-boundaries"]
---

# 1.136 Magnetic Material Interfaces and Spatially Varying Permeability

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 287

Several problems develop field analysis in regions whose permeability changes with position or changes abruptly across an interface. The key planning procedure is to determine $\mathbf{H}$ from free current using Ampère's circuital law whenever symmetry permits, then obtain $\mathbf{B}$ from the local material relation $\mathbf{B}=\mu\mathbf{H}$. This distinction is especially clear in coaxial and filamentary geometries: the same enclosed free current can establish a common circulation pattern for $\mathbf{H}$, while $\mathbf{B}$ changes from region to region with permeability. For a planar interface between two magnetic media, the field is decomposed into normal and tangential components. In the absence of an appropriate surface current, tangential $\mathbf{H}$ is continuous, while normal $\mathbf{B}$ is continuous because $\nabla\cdot\mathbf{B}=0$. These conditions can change the field direction across the boundary. The source also includes continuously varying permeability, such as $\mu_r=az+1$, and composite cross sections inside a solenoid. In those cases, flux requires integration of the local $\mathbf{B}$ over the relevant area rather than multiplication by one uniform permeability.

## Page-Grounded Details

#### Page 287

8.20 (107,88),(154,107)Find H in a material where (a) $\mu_{r}=4.2$, there are $2.7\times 10^{29}$ atoms/m^3, and each atom has a dipole moment of $2.6\times 10^{-30}a_{y}$ A*m^2; (b) M= 270aₓ A/m and $\mu=2$ $\mu$H/m; (c) $\chi_{m}=0.7$ and B= 2aₓ T. (d) Find M in a material where bound surface current densities of 12aₓ A/m and -9aₓ A/m exist at $\rho=0.3$ m and 0.4 m, respectively.

8.21 (107,188),(154,206)Find the magnitude of the magnetization in a material for which (a) the magnetic flux density is 0.02 Wb/m^2; (b) the magnetic field intensity is 1200 A/m and the relative permeability is 1.005; (c) there are $7.2\times 10^{28}$ atoms per cubic meter, each having a dipole moment of $4\times 10^{-30}$ A*m^2 in the same direction, and the magnetic susceptibility is 0.003.

8.22 (107,286),(154,305)Under some conditions, it is possible to approximate the effects of ferromagnetic materials by assuming linearity in the relationship of B and H. Let $\mu_{r}=1000$ for a certain material of which a cylindrical wire of radius 1 mm is made. If I= 1 A and the current distribution is uniform, find (a) B, (b) H, (c) M, (d) J, and (e) J$_{B}$ within the wire.

8.23 (107,

[Truncated for analysis]

## Core Ideas

- Free current and symmetry are used first to determine $\mathbf{H}$.
- Local magnetic flux density follows from $\mathbf{B}=\mu\mathbf{H}$.
- Piecewise permeability can make $\mathbf{B}$ discontinuous even when the circulation of $\mathbf{H}$ has the same current source.
- Normal $\mathbf{B}$ is continuous across a magnetic-material interface.
- Tangential $\mathbf{H}$ is continuous when no free surface current is present.
- Continuously varying permeability requires local field evaluation and flux integration.
- Composite material regions can divide total flux unevenly.

## Source Anchors

- Problem 8.23 specifies three radial permeability layers in a coaxial cable and asks for $H_\phi$, $B_\phi$, and $M_\phi$ at selected radii.
- Problem 8.24 places two current sheets around a material with $\mu_r=az+1$ and asks for $\mathbf{H}$, $\mathbf{B}$, and total flux.
- Problem 8.25 gives a current filament surrounded by regions with $\mu_r=1$, $6$, and $1$ and asks for $\mathbf{H}$ and $\mathbf{B}$ everywhere.
- Problem 8.26 divides a solenoid cross section into regions with $\mu_r=5$ and $\mu_r=1$ and asks for a boundary radius satisfying flux constraints.
- Problem 8.27 asks for normal and tangential components of $\mathbf{H}$ across an interface with $\mu_{r1}=2$ and $\mu_{r2}=5$.

## Related Pages

- [[magnetization-magnetic-materials-and-bound-currents|Magnetization, Magnetic Materials, and Bound Currents]]
- [[magnetic-circuits-reluctance-and-air-gaps|Magnetic Circuits, Reluctance, and Air Gaps]]
- [[maxwell-equations-in-integral-form-and-field-boundaries|Maxwell Equations in Integral Form and Field Boundaries]]

## Concept Dependencies

- depends-on: [[maxwell-equations-in-integral-form-and-field-boundaries|Maxwell Equations in Integral Form and Field Boundaries]]
- related: [[magnetic-circuits-reluctance-and-air-gaps|Magnetic Circuits, Reluctance, and Air Gaps]]
