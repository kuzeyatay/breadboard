---
title: "Spherical Gaussian Surface for a Point Charge"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "spherical-gaussian-surface-for-a-point-charge"
locations: ["Page 66", "Page 67", "Page 68", "Page 69", "Page 84", "Page 85", "Figure 3.3"]
related: ["gauss-law-in-integral-form", "choosing-gaussian-surfaces-by-symmetry", "maxwells-first-equation", "fields-from-layered-charge-distributions"]
---

## ConceptNode: Spherical Gaussian Surface for a Point Charge

Planning node for [[spherical-gaussian-surface-for-a-point-charge|1.56 Spherical Gaussian Surface for a Point Charge]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 66, Page 67, Page 68, Page 69, Page 84, Page 85, Figure 3.3

A point charge at the origin produces a radially directed field with spherical symmetry. A sphere centered at the charge is therefore the natural gaussian surface because $\mathbf{D}$ is normal to the sphere and has the same magnitude at every point on it. For a sphere of radius $r$, Gauss's law reduces to $Q=D_r\oint_S dS=D_r(4\pi r^2)$. Solving gives $D_r=Q/(4\pi r^2)$ and hence $\mathbf{D}=Q\mathbf{a}_r/(4\pi r^2)$. In free space, $\mathbf{E}=\mathbf{D}/\epsilon_0$, so $\mathbf{E}=Q\mathbf{a}_r/(4\pi\epsilon_0r^2)$. Example 3.1 verifies the result by explicitly integrating the spherical area element $d\mathbf{S}=r^2\sin\theta\,d\theta\,d\phi\,\mathbf{a}_r$ over $0\leq\theta\leq\pi$ and $0\leq\phi\leq2\pi$. The calculation yields total flux $Q$, independently of the sphere radius. This demonstrates both the inverse-square dependence and the conservation of total flux through concentric spheres.

### Key planning details

- Spherical symmetry implies $\mathbf{D}=D_r(r)\mathbf{a}_r$.
- A centered sphere makes $\mathbf{D}$ normal and constant in magnitude over the surface.
- The sphere area is $4\pi r^2$.
- Gauss's law gives $D_r=Q/(4\pi r^2)$.
- In free space, $\mathbf{E}=Q\mathbf{a}_r/(4\pi\epsilon_0r^2)$.
- The total flux through every centered sphere enclosing the charge is $Q$.
- The field magnitude decreases as $1/r^2$ while spherical area increases as $r^2$.

### Source coverage

- Example 3.1 on Pages 66 and 67 uses a spherical surface of radius $a$ around a point charge at the origin.
- Page 66 gives $d\mathbf{S}=a^2\sin\theta\,d\theta\,d\phi\,\mathbf{a}_r$.
- Page 67 evaluates the complete spherical integral and obtains $Q$.
- Pages 68 and 69 derive $Q=4\pi r^2D_S$ and $\mathbf{D}=Q\mathbf{a}_r/(4\pi r^2)$.
- S1.P67.F1 shows that $\mathbf{D}$ is normal to the spherical surface and constant in magnitude on it.
- Problems 3.7, 3.9, 3.13, and 3.17 on Pages 84 and 85 extend the method to spherically symmetric volume and surface charge distributions.
