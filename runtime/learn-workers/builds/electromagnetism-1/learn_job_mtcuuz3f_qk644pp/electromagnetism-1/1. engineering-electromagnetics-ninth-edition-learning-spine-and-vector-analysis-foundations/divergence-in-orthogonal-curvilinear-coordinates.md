---
title: "1.344 Divergence in Orthogonal Curvilinear Coordinates"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 570, Section A.2"]
related: ["orthogonal-curvilinear-coordinates-and-scale-factors", "gradient-curl-and-laplacian-in-curvilinear-coordinates", "vector-identities-for-electromagnetic-analysis"]
---

# 1.344 Divergence in Orthogonal Curvilinear Coordinates

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 570, Section A.2

Divergence is derived by computing the net outward flux through the six faces of a differential curvilinear volume. For the pair of faces normal to $\mathbf{a}_u$, the area is $h_2h_3\,dv\,dw$, and the first-order difference between opposite-face fluxes produces $\frac{\partial}{\partial u}(h_2h_3D_u)\,du\,dv\,dw$. Cyclic permutations supply the corresponding $v$ and $w$ contributions. Dividing total outward flux by the differential volume $h_1h_2h_3\,du\,dv\,dw$ gives
$$
\nabla\cdot\mathbf{D}=\frac{1}{h_1h_2h_3}\left[\frac{\partial}{\partial u}(h_2h_3D_u)+\frac{\partial}{\partial v}(h_3h_1D_v)+\frac{\partial}{\partial w}(h_1h_2D_w)\right]
$$
 The metric factors appear because coordinate-face areas and volume vary with position. This formula is valid for any orthogonal coordinate system once its scale factors are known. Substituting rectangular, cylindrical, or spherical scale factors reproduces the familiar specialized divergence formulas. The derivation is directly grounded in flux per unit volume, preserving the physical interpretation of divergence as local source strength.

## Page-Grounded Details

#### Page 570

The choice of $u$, $v$, and $w$ has been made so that $\mathbf{a}_{u} \times \mathbf{a}_{v} = \mathbf{a}_{w}$ in all cases. More involved expressions for $h_{1}$, $h_{2}$, and $h_{3}$ are to be expected in other less familiar coordinate systems.$^{1}$

#### A.2 Divergence, Gradient, and Curl in General Curvilinear Coordinates

If the method used to develop divergence in Sections 3.4 and 3.5 is applied to the general curvilinear coordinate system, the flux of the vector $\mathbf{D}$ passing through the surface of the parallelepiped whose unit normal is $\mathbf{a}_{u}$ is
$$
D_{u0} dL_{2} dL_{3} + \frac{1}{2} \frac{\partial}{\partial u} (D_{u} dL_{2} dL_{3}) du
$$
or
$$
D_{u0} h_{2} h_{3} d v d w + \frac{1}{2} \frac{\partial}{\partial u} (D_{u} h_{2} h_{3} d v d w) d u
$$
and for the opposite face it is
$$
-D_{u0} h_{2} h_{3} d v d w + \frac{1}{2} \frac{\partial}{\partial u} (D_{u} h_{2} h_{3} d v d w) d u
$$
giving a total for these two faces of
$$
\frac{\partial}{\partial u} (D_{u} h_{2} h_{3} d v d w) d u
$$
Because $u$, $v$, and $w$ are independent variables, this last expression may be written as
$$ \frac{\partial}{\partial u} (h_{2} h_{3} D_{

[Truncated for analysis]

## Core Ideas

- Divergence is net outward flux divided by differential volume.
- A face normal to $\mathbf{a}_u$ has area $h_2h_3\,dv\,dw$.
- Opposite-face subtraction produces a derivative of both the field component and metric area factor.
- The denominator is the volume factor $h_1h_2h_3$.
- The other component contributions follow by cyclic permutation.
- Known scale factors specialize the formula to common coordinate systems.

## Source Anchors

- Page 570 derives the flux through the two faces normal to $\mathbf{a}_u$.
- The paired-face contribution is $\frac{\partial}{\partial u}(h_2h_3D_u)\,du\,dv\,dw$.
- The total flux includes analogous $v$ and $w$ terms.
- Equation (A.2) gives the full orthogonal-coordinate divergence formula.
- The derivation divides by $h_1h_2h_3\,du\,dv\,dw$.

## Related Pages

- [[orthogonal-curvilinear-coordinates-and-scale-factors|Orthogonal Curvilinear Coordinates and Scale Factors]]
- [[gradient-curl-and-laplacian-in-curvilinear-coordinates|Gradient, Curl, and Laplacian in Curvilinear Coordinates]]
- [[vector-identities-for-electromagnetic-analysis|Vector Identities for Electromagnetic Analysis]]

## Concept Dependencies

- depends-on: [[orthogonal-curvilinear-coordinates-and-scale-factors|Orthogonal Curvilinear Coordinates and Scale Factors]]
