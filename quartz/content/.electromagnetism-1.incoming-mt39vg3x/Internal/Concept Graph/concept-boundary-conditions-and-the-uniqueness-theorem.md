---
title: "Boundary Conditions and the Uniqueness Theorem"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "boundary-conditions-and-the-uniqueness-theorem"
locations: ["Page 176", "Page 191", "Page 192", "Page 193"]
related: ["laplaces-equation-in-three-coordinate-systems", "direct-integration-of-one-dimensional-laplace-problems", "laplace-and-poisson-boundary-value-problem-family"]
---

## ConceptNode: Boundary Conditions and the Uniqueness Theorem

Planning node for [[boundary-conditions-and-the-uniqueness-theorem|1.91 Boundary Conditions and the Uniqueness Theorem]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 176, Page 191, Page 192, Page 193

Laplace's equation alone does not identify a particular electrostatic field because every charge-free electrode configuration satisfies $\nabla^2V=0$. A specific solution emerges only when the geometry and boundary conditions are supplied. Conducting boundaries are equipotential surfaces, so their assigned potentials, such as $V_0$, $V_1$, or numerical voltage values, can define the problem. Other boundary conditions may specify the normal electric field, an equivalent surface charge density $\rho_S$, or a mixture of potential and field values on an enclosing surface. The Uniqueness Theorem states that a potential satisfying both the governing equation and all specified boundary conditions is the only possible solution. This theorem changes solution strategy: a candidate need not be obtained by one mandatory derivation method. If it satisfies Laplace's or Poisson's equation and the complete boundary data, it is the physical potential. The chapter's later problems repeatedly use continuity of $V$ and appropriate continuity conditions on $\mathbf{D}$ at dielectric interfaces to complete piecewise boundary-value solutions.

### Key planning details

- Laplace's equation requires boundary information to select one physical field.
- Conductors provide fixed-potential equipotential boundaries.
- Boundary data may specify $V$, $E$, $\rho_S$, or a mixture.
- A solution satisfying the equation and boundary conditions is unique.
- The theorem supports verification of proposed potential functions.
- Composite dielectric problems require interface continuity conditions.

### Source coverage

- The text states that all fields with $\rho_v=0$ satisfy Laplace's equation but have different potential values and spatial variations.
- Physical problems contain at least one conducting boundary and usually two or more.
- Specified $E$ or $\rho_S$ on an enclosing surface is identified as an alternative boundary condition.
- The Uniqueness Theorem is stated on Page 176.
- Problem 6.33 tests sums, differences, offsets, and products of two functions against both Laplace's equation and the original boundary values.
- Problems 6.31, 6.34, and 6.43 require piecewise solutions and interface continuity.
