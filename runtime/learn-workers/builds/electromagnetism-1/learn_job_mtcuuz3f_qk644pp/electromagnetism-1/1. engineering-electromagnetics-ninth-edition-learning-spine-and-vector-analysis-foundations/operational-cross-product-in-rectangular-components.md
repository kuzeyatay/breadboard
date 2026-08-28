---
title: "1.18 Operational Cross Product in Rectangular Components"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 25", "Section: 1.7.2 Operational Definition"]
related: ["geometric-procedures-using-dot-and-cross-products", "right-handed-curvilinear-unit-vector-bases", "vector-form-of-coulombs-law"]
---

# 1.18 Operational Cross Product in Rectangular Components

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 25, Section: 1.7.2 Operational Definition

The cross product can be evaluated without explicitly finding the included angle or constructing the normal unit vector. Write both vectors in rectangular components, distribute the product into nine unit-vector cross products, eliminate products of parallel unit vectors, and use the cyclic right-handed identities. The resulting component formula is
$$
\mathbf{A}\times\mathbf{B}=(A_yB_z-A_zB_y)\mathbf{a}_x+(A_zB_x-A_xB_z)\mathbf{a}_y+(A_xB_y-A_yB_x)\mathbf{a}_z
$$
 The same computation can be organized as a determinant whose first row contains $\mathbf{a}_x,\mathbf{a}_y,\mathbf{a}_z$. This procedure preserves both essential features of the cross product: its magnitude depends on the perpendicular parts of the vectors, and its direction follows the right-hand rule. The source also connects the operation to the magnetic force on a current-carrying segment, $\mathbf{F}=I\mathbf{L}\times\mathbf{B}$, and to geometric tasks such as constructing a normal to a triangle and finding its area.

## Page-Grounded Details

#### Page 25

a uniform magnetic field of flux density B is present. Using vector notation, we may write the result neatly as $\mathbf{F}=I\mathbf{L}\times\mathbf{B}$. This relationship will be obtained later in Chapter 8.

#### 1.7.2 Operational Definition

The evaluation of a cross product by means of its definition turns out to be more work than the evaluation of the dot product from its definition, for not only must we find the angle between the vectors, but we must also find an expression for the unit vector $\mathbf{a}_{N}$. This work may be avoided by using rectangular components for the two vectors A and B and expanding the cross product as a sum of nine simpler cross products, each involving two unit vectors,
$$
\begin{align*}\mathbf{A}\times\mathbf{B}&=A_{x}B_{x}\mathbf{a}_{x}\times\mathbf{a}_{x}+A_{x}B_{y}\mathbf{a}_{x}\times\mathbf{a}_{y}+A_{x}B_{z}\mathbf{a}_{x}\times\mathbf{a}_{z}\\ &+A_{y}B_{x}\mathbf{a}_{y}\times\mathbf{a}_{x}+A_{y}B_{y}\mathbf{a}_{y}\times\mathbf{a}_{y}+A_{y}B_{z}\mathbf{a}_{y}\times\mathbf{a}_{z}\\ &+A_{z}B_{x}\mathbf{a}_{z}\times\mathbf{a}_{x}+A_{z}B_{y}\mathbf{a}_{z}\times\mathbf{a}_{y}+A_{z}B_{z}\mathbf{a}_{z}\times\mathbf{a}_{z}\end{align*}
$$
We have

[Truncated for analysis]

## Core Ideas

- Expand a rectangular-coordinate cross product into nine pairwise unit-vector products.
- Use $\mathbf{a}_x\times\mathbf{a}_y=\mathbf{a}_z$, $\mathbf{a}_y\times\mathbf{a}_z=\mathbf{a}_x$, and $\mathbf{a}_z\times\mathbf{a}_x=\mathbf{a}_y$.
- Products of a unit vector with itself are zero.
- Reversing the order of two unit vectors reverses the sign of their cross product.
- The determinant form is a compact computational representation of the component formula.
- For two triangle side vectors, half the cross-product magnitude is the triangle area.
- Normalizing the cross product produces a unit vector perpendicular to the triangle plane.

## Source Anchors

- The magnetic-force relation is stated as $\mathbf{F}=I\mathbf{L}\times\mathbf{B}$.
- Equation (8) gives the full rectangular component formula for $\mathbf{A}\times\mathbf{B}$.
- Equation (9) expresses the cross product as a determinant.
- For $\mathbf{A}=2\mathbf{a}_x-3\mathbf{a}_y+\mathbf{a}_z$ and $\mathbf{B}=-4\mathbf{a}_x-2\mathbf{a}_y+5\mathbf{a}_z$, the result is $-13\mathbf{a}_x-14\mathbf{a}_y-16\mathbf{a}_z$.
- Problem D1.4 uses $\mathbf{R}_{AB}\times\mathbf{R}_{AC}$ to obtain a triangle area and a perpendicular unit vector.
- D1.4 reports $\mathbf{R}_{AB}\times\mathbf{R}_{AC}=24\mathbf{a}_x+78\mathbf{a}_y+20\mathbf{a}_z$, area $42.0$, and unit normal $0.286\mathbf{a}_x+0.928\mathbf{a}_y+0.238\mathbf{a}_z$.

## Related Pages

- [[geometric-procedures-using-dot-and-cross-products|Geometric Procedures Using Dot and Cross Products]]
- [[right-handed-curvilinear-unit-vector-bases|Right-Handed Curvilinear Unit-Vector Bases]]
- [[vector-form-of-coulombs-law|Vector Form of Coulomb's Law]]

## Concept Dependencies

- applies-to: [[geometric-procedures-using-dot-and-cross-products|Geometric Procedures Using Dot and Cross Products]]
- related: [[right-handed-curvilinear-unit-vector-bases|Right-Handed Curvilinear Unit-Vector Bases]]
