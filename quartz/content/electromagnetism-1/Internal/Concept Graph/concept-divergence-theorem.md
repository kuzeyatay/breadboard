---
title: "Divergence Theorem"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "divergence-theorem"
locations: ["Page 81", "Page 82", "Figure 3.7", "Example 3.5"]
related: ["gauss-law-in-integral-form", "differential-volume-derivation-of-divergence", "maxwells-first-equation", "divergence-as-local-flux-outflow", "gauss-law-and-divergence-problem-solving-methods"]
---

## ConceptNode: Divergence Theorem

Planning node for [[divergence-theorem|1.67 Divergence Theorem]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 81, Page 82, Figure 3.7, Example 3.5

The divergence theorem equates the outward flux of a vector field through a closed surface with the volume integral of its divergence throughout the enclosed region. For electric flux density, it is $\oint_S\mathbf{D}\cdot d\mathbf{S}=\int_V\nabla\cdot\mathbf{D}\,dv$. More generally, the theorem applies to any sufficiently differentiable vector field. Its physical basis can be understood by partitioning a volume into many small cells. Flux leaving one internal cell enters a neighboring cell, so contributions across shared internal boundaries cancel. Only flux crossing the outer boundary remains. For electrostatics, substituting $\nabla\cdot\mathbf{D}=\rho_v$ shows that the theorem reproduces Gauss's law. It also provides a choice between a double surface integral and a triple volume integral, allowing the easier calculation to be selected. Example 3.5 verifies both sides for $\mathbf{D}=2xy\mathbf{a}_x+x^2\mathbf{a}_y$ over a rectangular parallelepiped. The direct surface calculation and the integral of $\nabla\cdot\mathbf{D}=2y$ both yield $12$, which also represents $12$ C of enclosed charge.

### Key planning details

- The theorem is $\oint_S\mathbf{D}\cdot d\mathbf{S}=\int_V\nabla\cdot\mathbf{D}\,dv$.
- The surface must be the closed boundary of the integration volume.
- Internal flux contributions cancel between adjacent differential cells.
- Only flux through the outer boundary remains.
- The theorem applies to vector fields beyond electric flux density.
- Gauss's law follows by using $\nabla\cdot\mathbf{D}=\rho_v$.
- The theorem converts between a surface integral and a volume integral.
- Either side may be chosen according to computational convenience.

### Source coverage

- Page 81 derives $\oint_S\mathbf{D}\cdot d\mathbf{S}=\int_V\nabla\cdot\mathbf{D}\,dv$.
- Page 81 states that the surface integral of the normal component equals the volume integral of divergence.
- S1.P81.F1 illustrates the closed surface and enclosed volume used by the theorem.
- Page 82 explains cancellation of flux between neighboring differential compartments.
- Example 3.5 on Page 82 evaluates both sides for a rectangular parallelepiped and obtains $12$.
- Problem D3.9 on Page 82 asks for both sides over a cylindrical-coordinate region.
