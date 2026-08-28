---
title: "Right-Handed Curvilinear Unit-Vector Bases"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "right-handed-curvilinear-unit-vector-bases"
locations: ["Page 26", "Section: 1.8.2 Unit Vectors", "Page 27", "Figure 1.6b", "Page 31", "Figure 1.8c", "Page 32", "Section: 1.9.2 Unit Vectors in Spherical Coordinates"]
related: ["operational-cross-product-in-rectangular-components", "cylindrical-coordinates-and-coordinate-surfaces", "spherical-coordinates-and-coordinate-surfaces", "vector-component-transformation-by-projection"]
---

## ConceptNode: Right-Handed Curvilinear Unit-Vector Bases

Planning node for [[right-handed-curvilinear-unit-vector-bases|1.20 Right-Handed Curvilinear Unit-Vector Bases]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 26, Section: 1.8.2 Unit Vectors, Page 27, Figure 1.6b, Page 31, Figure 1.8c, Page 32, Section: 1.9.2 Unit Vectors in Spherical Coordinates

Unit vectors in curvilinear systems are defined locally from constant-coordinate surfaces. Each basis vector is normal to the surface on which its coordinate is constant and points toward increasing values of that coordinate. In cylindrical coordinates, $\mathbf{a}_\rho$ points radially outward, $\mathbf{a}_\phi$ is tangent to the cylinder and points toward increasing $\phi$, and $\mathbf{a}_z$ is identical to the rectangular $z$ unit vector. Unlike rectangular basis vectors, $\mathbf{a}_\rho$ and $\mathbf{a}_\phi$ change direction as $\phi$ changes, so they cannot be treated as constants during differentiation or integration with respect to $\phi$. In spherical coordinates, $\mathbf{a}_r$ points outward, $\mathbf{a}_\theta$ points toward increasing polar angle, and $\mathbf{a}_\phi$ points toward increasing azimuth. Both bases are orthonormal and right-handed, but their cyclic orders differ because their coordinate orders differ.

### Key planning details

- A curvilinear unit vector is normal to its constant-coordinate surface.
- $\mathbf{a}_\rho$ and $\mathbf{a}_\phi$ depend on $\phi$.
- $\mathbf{a}_z$ is shared by rectangular and cylindrical coordinates.
- The cylindrical orientation satisfies $\mathbf{a}_\rho\times\mathbf{a}_\phi=\mathbf{a}_z$.
- $\mathbf{a}_r$ is normal to a sphere and points outward.
- $\mathbf{a}_\theta$ is tangent to a sphere and points toward increasing $\theta$.
- $\mathbf{a}_\phi$ is shared by cylindrical and spherical coordinates.
- The spherical orientation satisfies $\mathbf{a}_r\times\mathbf{a}_\theta=\mathbf{a}_\phi$.

### Source coverage

- Figure 1.6b depicts the three cylindrical unit vectors.
- The text explicitly warns that $\mathbf{a}_\rho$ and $\mathbf{a}_\phi$ vary with $\phi$.
- Figure 1.8c depicts the spherical basis and states $\mathbf{a}_r\times\mathbf{a}_\theta=\mathbf{a}_\phi$.
- $\mathbf{a}_\theta$ is described as pointing south along a line analogous to longitude.
- $\mathbf{a}_\phi$ is described as pointing east and being tangent to both the cone and sphere.
