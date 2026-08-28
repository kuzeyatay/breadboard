---
title: "Lorenz Gauge and Potential Wave Equations"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "lorenz-gauge-and-potential-wave-equations"
locations: ["Page 308", "Page 309", "Section 9.5: The Retarded Potentials"]
related: ["time-varying-electromagnetic-potentials", "retarded-scalar-and-vector-potentials", "potential-and-duality-problems", "lossless-traveling-wave-solutions", "static-scalar-and-vector-potentials"]
---

## ConceptNode: Lorenz Gauge and Potential Wave Equations

Planning node for [[lorenz-gauge-and-potential-wave-equations|1.154 Lorenz Gauge and Potential Wave Equations]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 308, Page 309, Section 9.5: The Retarded Potentials

Specifying only the curl of a vector potential does not determine the potential uniquely. For example, if only $A_x$ is nonzero, the magnetic field determines the derivatives of $A_x$ with respect to $y$ and $z$ but gives no information about its variation with $x$. The missing information can be supplied by specifying $\nabla\cdot\mathbf{A}$ and fixing the potential at one point, commonly by requiring it to vanish at infinity. The source chooses the Lorenz gauge $$\nabla\cdot\mathbf{A}=-\mu\epsilon\frac{\partial V}{\partial t}.$$ Substitution into the coupled potential equations removes mixed scalar-vector terms and produces symmetric inhomogeneous wave equations: $$\nabla^2\mathbf{A}=-\mu\mathbf{J}+\mu\epsilon\frac{\partial^2\mathbf{A}}{\partial t^2},$$ $$\nabla^2V=-\frac{\rho_v}{\epsilon}+\mu\epsilon\frac{\partial^2V}{\partial t^2}.$$ Under static or dc conditions, these reduce to the corresponding Poisson equations.

### Key planning details

- A vector field requires curl, divergence, and a value at one point for complete specification.
- A potential constant is set to zero when fields must vanish at infinity.
- The Lorenz gauge is $\nabla\cdot\mathbf{A}=-\mu\epsilon\,\partial V/\partial t$.
- The gauge decouples the scalar and vector potential equations.
- The resulting equations have the structure of driven wave equations.

### Source coverage

- Page 308 uses an $A_x$-only example to show that curl information does not determine variation with $x$.
- Equation (54) defines $\nabla\cdot\mathbf{A}=-\mu\epsilon\,\partial V/\partial t$.
- Equations (55) and (56) give the vector and scalar potential wave equations.
- Pages 308 and 309 summarize the definitions $\mathbf{B}=\nabla\times\mathbf{A}$, the gauge condition, and $\mathbf{E}=-\nabla V-\partial\mathbf{A}/\partial t$.
