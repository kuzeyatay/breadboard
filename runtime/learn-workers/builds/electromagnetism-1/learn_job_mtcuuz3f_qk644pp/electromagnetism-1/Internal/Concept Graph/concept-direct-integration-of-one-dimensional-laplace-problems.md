---
title: "Direct Integration of One-Dimensional Laplace Problems"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "direct-integration-of-one-dimensional-laplace-problems"
locations: ["Page 176", "Page 177", "Page 178"]
related: ["laplaces-equation-in-three-coordinate-systems", "potential-to-charge-capacitance-workflow", "cylindrical-one-dimensional-potential-solutions", "spherical-one-dimensional-potential-solutions", "boundary-conditions-and-the-uniqueness-theorem"]
---

## ConceptNode: Direct Integration of One-Dimensional Laplace Problems

Planning node for [[direct-integration-of-one-dimensional-laplace-problems|1.92 Direct Integration of One-Dimensional Laplace Problems]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 176, Page 177, Page 178

Direct integration solves Laplace problems in which the potential depends on only one coordinate. Coordinate symmetry reduces the full partial differential equation to an ordinary differential equation. Although three coordinate systems might appear to produce nine single-coordinate cases, rotations and equivalent geometries reduce them to five distinct problems: one rectangular, two cylindrical, and two spherical. For $V=V(x)$, Laplace's equation becomes $d^2V/dx^2=0$, which integrates to $$V=Ax+B.$$ The two integration constants are fixed by two boundary conditions, as expected for a second-order differential equation. Surfaces of constant $x$ are parallel planes, so this solution represents a parallel-plate geometry. With $V=0$ at $x=0$ and $V=V_0$ at $x=d$, the potential is $$V=\frac{V_0x}{d}.$$ The electric field is uniform and directed opposite increasing potential: $$\mathbf{E}=-\frac{V_0}{d}\mathbf{a}_x.$$ This example establishes the general pattern of symmetry reduction, integration, application of boundary values, and physical interpretation of constant-coordinate surfaces.

### Key planning details

- Direct integration requires $V$ to depend on only one coordinate.
- Symmetry reduces the PDE to an ODE.
- There are five distinct one-dimensional cases across the three coordinate systems.
- A second-order equation produces two integration constants.
- Boundary conditions determine both constants.
- For parallel planes, $V=V_0x/d$.
- The resulting parallel-plate electric field is uniform.

### Source coverage

- Section 6.7 identifies direct integration as the simplest method.
- The source counts one rectangular, two cylindrical, and two spherical cases.
- Equation (31) gives $V=Ax+B$.
- Equation (32) gives $V=V_0x/d$.
- Constant-$x$ surfaces are identified as parallel equipotential planes normal to the $x$ axis.
- Example 6.2 interprets this as a parallel-plate capacitor.
