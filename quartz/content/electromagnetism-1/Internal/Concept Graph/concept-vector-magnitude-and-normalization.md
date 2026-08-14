---
title: "Vector Magnitude and Normalization"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "vector-magnitude-and-normalization"
locations: ["Page 19"]
related: ["rectangular-vector-components-and-unit-vectors", "displacement-vectors-between-points", "dot-product-as-scalar-projection", "cross-product-orientation-and-magnitude"]
---

## ConceptNode: Vector Magnitude and Normalization

Planning node for [[vector-magnitude-and-normalization|1.11 Vector Magnitude and Normalization]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 19

The magnitude of a rectangular vector follows from the three-dimensional Pythagorean relation. For $$\mathbf{B}=B_x\mathbf{a}_x+B_y\mathbf{a}_y+B_z\mathbf{a}_z,$$ its magnitude is $$|\mathbf{B}|=\sqrt{B_x^2+B_y^2+B_z^2}.$$ A unit vector in the direction of any nonzero vector is obtained by dividing that vector by its magnitude: $$\mathbf{a}_B=\frac{\mathbf{B}}{|\mathbf{B}|}.$$ Example 1.1 applies this procedure to the point $G(2,-2,-1)$. The vector from the origin is $\mathbf{G}=2\mathbf{a}_x-2\mathbf{a}_y-\mathbf{a}_z$, and its magnitude is $3$. Dividing each component by $3$ gives $$\mathbf{a}_G=\frac{2}{3}\mathbf{a}_x-\frac{2}{3}\mathbf{a}_y-\frac{1}{3}\mathbf{a}_z.$$ Normalization preserves direction while scaling the magnitude to one. It is essential when a calculation requires direction alone, especially in projections, surface normals, and cross-product descriptions.

### Key planning details

- Magnitude is the square root of the sum of squared rectangular components.
- Normalization divides a nonzero vector by its magnitude.
- A normalized vector has magnitude one.
- Normalization preserves the original direction.
- Signed components remain signed after normalization.
- The notation $\mathbf{a}_B$ identifies a unit vector in the direction of $\mathbf{B}$.
- Unit directions are prerequisites for scalar and vector projections.

### Source coverage

- Equation (1) gives $|\mathbf{B}|=\sqrt{B_x^2+B_y^2+B_z^2}$.
- Equation (2) gives $\mathbf{a}_B=\mathbf{B}/|\mathbf{B}|$.
- Example 1.1 constructs $\mathbf{G}=2\mathbf{a}_x-2\mathbf{a}_y-\mathbf{a}_z$.
- The example calculates $|\mathbf{G}|=3$.
- The normalized result is approximately $0.667\mathbf{a}_x-0.667\mathbf{a}_y-0.333\mathbf{a}_z$.
