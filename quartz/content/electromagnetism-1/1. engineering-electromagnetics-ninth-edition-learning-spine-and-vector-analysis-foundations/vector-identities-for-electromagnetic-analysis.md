---
title: "1.346 Vector Identities for Electromagnetic Analysis"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 572, Section A.3", "Page 581, Appendix D"]
related: ["divergence-in-orthogonal-curvilinear-coordinates", "gradient-curl-and-laplacian-in-curvilinear-coordinates", "uniqueness-theorem-for-laplace-and-poisson-equations"]
---

# 1.346 Vector Identities for Electromagnetic Analysis

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 572, Section A.3, Page 581, Appendix D

The appendix collects vector identities that support electromagnetic derivations. The scalar triple product is invariant under cyclic permutation, while the vector triple product satisfies $\mathbf{A}\times(\mathbf{B}\times\mathbf{C})=(\mathbf{A}\cdot\mathbf{C})\mathbf{B}-(\mathbf{A}\cdot\mathbf{B})\mathbf{C}$. Divergence, gradient, and curl distribute over sums. Product rules include $\nabla\cdot(V\mathbf{A})=\mathbf{A}\cdot\nabla V+V\nabla\cdot\mathbf{A}$, $\nabla(VW)=V\nabla W+W\nabla V$, and $\nabla\times(V\mathbf{A})=\nabla V\times\mathbf{A}+V\nabla\times\mathbf{A}$. Identities for vector products expand the divergence of a cross product, the gradient of a dot product, and the curl of a cross product. The second-order identities include $\nabla\cdot(\nabla\times\mathbf{A})=0$, $\nabla\times(\nabla V)=0$, and
$$
\nabla\times\nabla\times\mathbf{A}=\nabla(\nabla\cdot\mathbf{A})-\nabla^2\mathbf{A}
$$
 These identities are algebraic tools, but they also encode important structural facts such as curls being divergence-free and gradients being irrotational. The scalar-vector divergence product rule is later used directly in the uniqueness proof.

## Page-Grounded Details

#### Page 572

The Laplacian of a scalar is found by using (A.2) and (A.3):
$$
\nabla^{2}V=\nabla\cdot\nabla V=\frac{1}{h_{1} h_{2} h_{3}}\left[\frac{\partial}{\partial u}\left(\frac{h_{2} h_{3}}{h_{1}} \frac{\partial v}{\partial u}\right)+\frac{\partial}{\partial v}\left(\frac{h_{3} h_{1}}{h_{2}} \frac{\partial V}{\partial v}\right)\right.{}
$$
$$
\left.+\frac{\partial}{\partial w}\left(\frac{h_{1} h_{2}}{h_{3}} \frac{\partial V}{\partial w}\right)\right](A.5)
$$
Equations (A.2) to (A.5) may be used to find the divergence, gradient, curl, and Laplacian in any orthogonal coordinate system for which $h_1, h_2$, and $h_3$ are known.

Expressions for $\nabla\cdot\mathbf{D}$, $\nabla V$, $\nabla\times\mathbf{H}$, and $\nabla^{2} V$ are given in rectangular, circular cylindrical, and spherical coordinate systems at the end of the book.

#### A.3 Vector Identities

The vector identities that follow may be proved by expansion in rectangular (or general curvilinear) coordinates. The first two identities involve the scalar and vector triple products, the next three are concerned with operations on sums, the following three apply to operations when the argument is multiplied by a scalar function, the nex

[Truncated for analysis]

#### Page 581

### The Uniqueness Theorem

Let us assume that we have two solutions of Laplace's equation, $V_{1}$ and $V_{2}$, both general functions of the coordinates used. Therefore
$$
\nabla^{2}V_{1}=0
$$
and
$$
\nabla^{2}V_{2}=0
$$
from which
$$
\nabla^{2}(V_{1}-V_{2})=0
$$
Each solution must also satisfy the boundary conditions, and if we represent the given potential values on the boundaries by $V_{b}$, then the value of $V_{1}$ on the boundary $V_{1b}$ and the value of $V_{2}$ on the boundary $V_{2b}$ must both be identical to $V_{b}$,
$$
V_{1b}=V_{2b}=V_{b}
$$
or
$$
V_{1b}-V_{2b}=0
$$
In Section 4.8, Eq. (43), we made use of a vector identity,
$$
\nabla\cdot(V\mathbf{D})\equiv V(\nabla\cdot\mathbf{D})+\mathbf{D}\cdot(\nabla V)
$$
which holds for any scalar $V$ and any vector $\mathbf{D}$. For the present application we shall select $V_{1}-V_{2}$ as the scalar and $\nabla(V_{1}-V_{2})$ as the vector, giving
$$
\begin{align*}\nabla\cdot[(V_{1}-V_{2})\nabla(V_{1}-V_{2})]&\equiv(V_{1}-V_{2})[\nabla\cdot\nabla(V_{1}-V_{2})]\\+&\nabla(V_{1}-V_{2})\cdot\nabla(V_{1}-V_{2})\end{align*}
$$
## Core Ideas

- Scalar triple products are invariant under cyclic permutation.
- The vector triple product is not associative and must be expanded by identity.
- Vector differential operators distribute over sums.
- Scalar multiplication introduces product-rule terms.
- $\nabla\cdot(\nabla\times\mathbf{A})=0$.
- $\nabla\times(\nabla V)=0$.
- The double-curl identity separates longitudinal and Laplacian contributions.

## Source Anchors

- Equations (A.6) and (A.7) give scalar and vector triple-product identities.
- Equations (A.8) to (A.10) give sum rules.
- Equations (A.11) to (A.13) give scalar product rules for differential operators.
- Equations (A.14) to (A.16) give vector-product operator identities.
- Equations (A.17) to (A.20) give second-order identities.
- The identity $\nabla\cdot(V\mathbf{D})=V\nabla\cdot\mathbf{D}+\mathbf{D}\cdot\nabla V$ is used on Page 581.

## Related Pages

- [[divergence-in-orthogonal-curvilinear-coordinates|Divergence in Orthogonal Curvilinear Coordinates]]
- [[gradient-curl-and-laplacian-in-curvilinear-coordinates|Gradient, Curl, and Laplacian in Curvilinear Coordinates]]
- [[uniqueness-theorem-for-laplace-and-poisson-equations|Uniqueness Theorem for Laplace and Poisson Equations]]

## Concept Dependencies

- applies-to: [[gradient-curl-and-laplacian-in-curvilinear-coordinates|Gradient, Curl, and Laplacian in Curvilinear Coordinates]]
