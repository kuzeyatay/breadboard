---
title: "Del Operator and Divergence Notation"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "del-operator-and-divergence-notation"
locations: ["Page 79", "Page 80"]
related: ["divergence-as-local-flux-outflow", "divergence-in-coordinate-systems", "maxwells-first-equation", "divergence-theorem"]
---

## ConceptNode: Del Operator and Divergence Notation

Planning node for [[del-operator-and-divergence-notation|1.66 Del Operator and Divergence Notation]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 79, Page 80

The del operator packages spatial partial derivatives into vector-operator notation. In rectangular coordinates it is defined as $\nabla=\mathbf{a}_x\partial/\partial x+\mathbf{a}_y\partial/\partial y+\mathbf{a}_z\partial/\partial z$. Formally applying a dot operation to a vector field gives $\nabla\cdot\mathbf{D}=\partial D_x/\partial x+\partial D_y/\partial y+\partial D_z/\partial z$, which is the divergence. The unit-vector dot products remove cross terms, while the operator components differentiate the matching field components. The notation $\nabla\cdot\mathbf{D}$ is widely used, while $\operatorname{div}\mathbf{D}$ more directly recalls the physical meaning. The operator also acts on a scalar field $u$ to form the gradient $\nabla u$, a vector containing the three rectangular partial derivatives. The text cautions that the simple rectangular expression for $\nabla$ cannot be transferred unchanged to cylindrical or spherical coordinates. Although $\nabla\cdot\mathbf{D}$ still means divergence in those systems, the full coordinate-specific divergence formula must be used.

### Key planning details

- In rectangular coordinates, $\nabla=\mathbf{a}_x\partial_x+\mathbf{a}_y\partial_y+\mathbf{a}_z\partial_z$.
- The dot operation $\nabla\cdot\mathbf{D}$ produces divergence.
- The result of $\nabla\cdot\mathbf{D}$ is a scalar.
- The gradient $\nabla u$ acts on a scalar and produces a vector.
- The rectangular form of $\nabla$ does not directly generate curvilinear-coordinate formulas.
- In cylindrical coordinates, use the complete cylindrical divergence expression.
- Operator notation and physical divergence notation represent the same operation.

### Source coverage

- Page 80 defines the rectangular del operator.
- Page 80 expands $\nabla\cdot\mathbf{D}$ and identifies it with $\operatorname{div}\mathbf{D}$.
- Page 80 introduces $\nabla u$ as the gradient of a scalar field.
- Page 80 states that $\nabla\cdot\mathbf{D}$ remains divergence in cylindrical coordinates.
- Page 80 warns that there is no simple standalone form of $\nabla$ supplied there for generating the cylindrical expression.
