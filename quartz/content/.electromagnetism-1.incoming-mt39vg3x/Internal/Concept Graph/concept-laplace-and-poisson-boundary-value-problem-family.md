---
title: "Laplace and Poisson Boundary-Value Problem Family"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "laplace-and-poisson-boundary-value-problem-family"
locations: ["Page 190", "Page 191", "Page 192", "Page 193"]
related: ["derivation-of-poissons-equation", "laplaces-equation-in-three-coordinate-systems", "boundary-conditions-and-the-uniqueness-theorem", "one-dimensional-poisson-solution-for-a-pn-junction", "capacitor-geometry-and-dielectric-design-problems"]
---

## ConceptNode: Laplace and Poisson Boundary-Value Problem Family

Planning node for [[laplace-and-poisson-boundary-value-problem-family|1.100 Laplace and Poisson Boundary-Value Problem Family]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 190, Page 191, Page 192, Page 193

The later problems consolidate a general workflow for electrostatic boundary-value calculations. First identify whether the region contains volume charge. Use Laplace's equation where $\rho_v=0$ and Poisson's equation where $\rho_v$ is specified. Next choose the coordinate system matching the geometry, reduce the equation by symmetry, integrate, and determine constants from conductor potentials, field conditions, regularity, behavior at infinity, and interface continuity. Problems include piecewise spherical potentials, prescribed exponential or polynomial potentials, grounded plates surrounding uniform charge, uniformly charged spheres, mixed charged-dielectric regions, and spatially varying permittivity. Several tasks reverse the usual direction by applying the Laplacian to a known $V$ to find $\rho_v$. Others require solving piecewise Laplace and Poisson equations and enforcing continuity of $V$ and $\mathbf{D}$ where no free surface charge exists. The set also tests linearity and uniqueness by asking which combinations of known harmonic functions satisfy both the equation and the original boundary values.

### Key planning details

- Choose Laplace's equation for charge-free regions and Poisson's equation for regions containing volume charge.
- Use geometry to select rectangular, cylindrical, or spherical coordinates.
- Boundary values determine integration constants.
- Regularity at the origin and decay at infinity can serve as boundary conditions.
- Known potentials can be differentiated twice to recover volume charge density.
- Piecewise media require continuity conditions at interfaces.
- Linearity of Laplace's equation does not guarantee preservation of boundary values.

### Source coverage

- Problem 6.24 gives a piecewise spherical potential and asks for charge density and total charge.
- Problem 6.25 asks for the concentric-sphere potential by solving Laplace's equation.
- Problem 6.27 uses $V(x,y)=4e^{2x}+f(x)-3y^2$ with $\rho_v=0$ and conditions at the origin.
- Problem 6.30 places uniform volume charge between grounded parallel plates.
- Problem 6.32 places uniform volume charge inside a grounded spherical shell.
- Problem 6.34 requires Poisson and Laplace solutions on opposite sides of an interface with continuous $V$ and $\mathbf{D}$.
- Problem 6.36 investigates when spatially varying $\epsilon$ remains compatible with the displayed Laplace and Poisson forms.
- Problem 6.46 asks for center potential using conditions at $r=0$ and $r=a$.
