---
title: "1.345 Gradient, Curl, and Laplacian in Curvilinear Coordinates"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 571, Section A.2", "Page 572, Section A.2"]
related: ["orthogonal-curvilinear-coordinates-and-scale-factors", "divergence-in-orthogonal-curvilinear-coordinates", "vector-identities-for-electromagnetic-analysis", "uniqueness-theorem-for-laplace-and-poisson-equations"]
---

# 1.345 Gradient, Curl, and Laplacian in Curvilinear Coordinates

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 571, Section A.2, Page 572, Section A.2

The gradient follows by matching the scalar differential $dV$ to $\nabla V\cdot d\mathbf{L}$, where $d\mathbf{L}=h_1du\mathbf{a}_u+h_2dv\mathbf{a}_v+h_3dw\mathbf{a}_w$. This gives
$$
\nabla V=\frac{1}{h_1}\frac{\partial V}{\partial u}\mathbf{a}_u+\frac{1}{h_2}\frac{\partial V}{\partial v}\mathbf{a}_v+\frac{1}{h_3}\frac{\partial V}{\partial w}\mathbf{a}_w
$$
 Curl is derived from circulation around a differential coordinate-surface loop. Its $u$ component is
$$
(\nabla\times\mathbf{H})_u=\frac{1}{h_2h_3}\left[\frac{\partial}{\partial v}(h_3H_w)-\frac{\partial}{\partial w}(h_2H_v)\right]
$$
 with the other components obtained cyclically and the complete operator represented by determinant (A.4). Applying divergence to the gradient gives the scalar Laplacian
$$
\nabla^2V=\frac{1}{h_1h_2h_3}\left[\frac{\partial}{\partial u}\left(\frac{h_2h_3}{h_1}\frac{\partial V}{\partial u}\right)+\frac{\partial}{\partial v}\left(\frac{h_3h_1}{h_2}\frac{\partial V}{\partial v}\right)+\frac{\partial}{\partial w}\left(\frac{h_1h_2}{h_3}\frac{\partial V}{\partial w}\right)\right]
$$
## Page-Grounded Details

#### Page 571

in terms of the component differential lengths, $h_1du$, $h_2dv$, and $h_3dw$,
$$
dV=\frac{1}{h_1}\frac{\partial V}{\partial u}h_1du+\frac{1}{h_2}\frac{\partial V}{\partial v}h_2dv+\frac{1}{h_3}\frac{\partial V}{\partial w}h_3dw
$$
Then, because
$$
d\mathbf{L}=h_1du\mathbf{a}_u+h_2dv\mathbf{a}_v+h_3dw\mathbf{a}_w\qquad\text{and}\qquad dV=\nabla V\cdot d\mathbf{L}
$$
 we see that
$$
\nabla V=\frac{1}{h_1}\frac{\partial V}{\partial u}\mathbf{a}_u+\frac{1}{h_2}\frac{\partial V}{\partial v}\mathbf{a}_v+\frac{1}{h_3}\frac{\partial V}{\partial w}\mathbf{a}_w\qquad(A.3)
$$
 The components of the curl of a vector $\mathbf{H}$ are obtained by considering a differ-ential path first in a u = constant surface and finding the circulation of $\mathbf{H}$ about that path, as discussed for rectangular coordinates in Section 7.3. The contribution along the segment in the $a_{v}$ direction is
$$
H_{v0}h_2dv-\frac{1}{2}\frac{\partial}{\partial w}(H_{v}h_2dv)dw
$$
 and that from the oppositely directed segment is
$$
-H_{v0}h_2dv-\frac{1}{2}\frac{\partial}{\partial w}(H_{v}h_2dv)dw
$$
 The sum of these two parts is
$$
-\frac{\partial}{\partial w}(H_{v}h_{2}dv)dw
$$
 or
$$
-\frac{\partial}{

[Truncated for analysis]

#### Page 572

The Laplacian of a scalar is found by using (A.2) and (A.3):
$$
 \nabla^{2}V=\nabla\cdot\nabla V=\frac{1}{h_{1} h_{2} h_{3}}\left[\frac{\partial}{\partial u}\left(\frac{h_{2} h_{3}}{h_{1}} \frac{\partial v}{\partial u}\right)+\frac{\partial}{\partial v}\left(\frac{h_{3} h_{1}}{h_{2}} \frac{\partial V}{\partial v}\right)\right.{}
$$
$$
 \left.+\frac{\partial}{\partial w}\left(\frac{h_{1} h_{2}}{h_{3}} \frac{\partial V}{\partial w}\right)\right](A.5) $$
Equations (A.2) to (A.5) may be used to find the divergence, gradient, curl, and Laplacian in any orthogonal coordinate system for which $h_1, h_2$, and $h_3$ are known.

Expressions for $\nabla\cdot\mathbf{D}$, $\nabla V$, $\nabla\times\mathbf{H}$, and $\nabla^{2} V$ are given in rectangular, circular cylindrical, and spherical coordinate systems at the end of the book.

#### A.3 Vector Identities

The vector identities that follow may be proved by expansion in rectangular (or general curvilinear) coordinates. The first two identities involve the scalar and vector triple products, the next three are concerned with operations on sums, the following three apply to operations when the argument is multiplied by a scalar function, the nex

[Truncated for analysis]

## Core Ideas

- Gradient components are directional rates per unit physical length.
- Each gradient component contains the reciprocal scale factor $1/h_i$.
- Curl is circulation per enclosed physical area.
- The $u$ curl component uses derivatives with respect to $v$ and $w$.
- The other curl components follow by cyclic permutation.
- The scalar Laplacian is $\nabla\cdot\nabla V$.
- Equations (A.2) through (A.5) apply to any orthogonal system with known scale factors.

## Source Anchors

- Equation (A.3) gives the general gradient formula.
- Page 571 derives the $\mathbf{a}_u$ component of curl from a loop in a $u=\mathrm{constant}$ surface.
- Equation (A.4) gives curl as a determinant involving scale factors.
- Equation (A.5) gives the scalar Laplacian.
- Page 572 states that Eqs. (A.2) to (A.5) apply to any orthogonal coordinate system with known $h_1,h_2,h_3$.

## Related Pages

- [[orthogonal-curvilinear-coordinates-and-scale-factors|Orthogonal Curvilinear Coordinates and Scale Factors]]
- [[divergence-in-orthogonal-curvilinear-coordinates|Divergence in Orthogonal Curvilinear Coordinates]]
- [[vector-identities-for-electromagnetic-analysis|Vector Identities for Electromagnetic Analysis]]
- [[uniqueness-theorem-for-laplace-and-poisson-equations|Uniqueness Theorem for Laplace and Poisson Equations]]

## Concept Dependencies

- depends-on: [[orthogonal-curvilinear-coordinates-and-scale-factors|Orthogonal Curvilinear Coordinates and Scale Factors]]
- depends-on: [[divergence-in-orthogonal-curvilinear-coordinates|Divergence in Orthogonal Curvilinear Coordinates]]
