---
title: "1.66 Del Operator and Divergence Notation"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 79", "Page 80"]
related: ["divergence-as-local-flux-outflow", "divergence-in-coordinate-systems", "maxwells-first-equation", "divergence-theorem"]
---

# 1.66 Del Operator and Divergence Notation

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 79, Page 80

The del operator packages spatial partial derivatives into vector-operator notation. In rectangular coordinates it is defined as $\nabla=\mathbf{a}_x\partial/\partial x+\mathbf{a}_y\partial/\partial y+\mathbf{a}_z\partial/\partial z$. Formally applying a dot operation to a vector field gives $\nabla\cdot\mathbf{D}=\partial D_x/\partial x+\partial D_y/\partial y+\partial D_z/\partial z$, which is the divergence. The unit-vector dot products remove cross terms, while the operator components differentiate the matching field components. The notation $\nabla\cdot\mathbf{D}$ is widely used, while $\operatorname{div}\mathbf{D}$ more directly recalls the physical meaning. The operator also acts on a scalar field $u$ to form the gradient $\nabla u$, a vector containing the three rectangular partial derivatives. The text cautions that the simple rectangular expression for $\nabla$ cannot be transferred unchanged to cylindrical or spherical coordinates. Although $\nabla\cdot\mathbf{D}$ still means divergence in those systems, the full coordinate-specific divergence formula must be used.

## Page-Grounded Details

#### Page 79

As a specific illustration, let us consider the divergence of $\mathbf{D}$ in the region about a point charge $Q$ located at the origin. We have the field
$$
\mathbf{D}=\frac{Q}{4\pi r^{2}}\mathbf{a}_{r}
$$
and use (14), the expression for divergence in spherical coordinates:
$$
\operatorname{div}\mathbf{D}=\frac{1}{r^{2}}\frac{\partial}{\partial r}(r^{2}D_{r})+\frac{1}{r\sin\theta}\frac{\partial}{\partial\theta}(D_{\theta}\sin\theta)+\frac{1}{r\sin\theta}\frac{\partial D_{\phi}}{\partial\phi}
$$
Because $D_{\theta}$ and $D_{\phi}$ are zero, we have
$$
\operatorname{div}\mathbf{D}=\frac{1}{r^{2}}\frac{d}{dr}(r^{2}\frac{Q}{4\pi r^{2}})=0\qquad(\text{if}r\neq 0)
$$
Thus, $\rho_{v}=0$ everywhere except at the origin, where it is infinite.

The divergence operation is not limited to electric flux density; it can be applied to any vector field. We will apply it to several other electromagnetic fields in the coming chapters.

D3.8. Determine an expression for the volume charge density associated with each $\mathbf{D}$ field: $(a)$ $\mathbf{D}=\frac{4xy}{z}\mathbf{a}_{x}+\frac{2x^{2}}{z}\mathbf{a}_{y}-\frac{2x^{2}y}{z^{2}}\mathbf{a}_{z}$ ; $(b)$ $ \mathbf{D}=z\sin\

[Truncated for analysis]

#### Page 80

With this in mind, we define the del operator $\nabla$ as a vector operator,
$$
\nabla=\frac{\partial}{\partial x}a_{x}+\frac{\partial}{\partial y}a_{y}+\frac{\partial}{\partial z}a_{z}\quad{(16)}
$$
Similar scalar operators appear in several methods of solving differential equations where we often let $D$ replace $d/dx$, $D^{2}$ replace $d^{2}/dx^{2}$, and so forth.$ ^{4}
$$
\nabla $ is treated in every way as an ordinary vector with the one important exception that partial derivatives result instead of products of scalars.

##3.5.2 Obtaining Divergence with the Del Operator

Consider the operation $\nabla\cdot D$, signifying
$$
 \nabla\cdot D=\left(\frac{\partial}{\partial x}a_{x}+\frac{\partial}{\partial y}a_{y}+\frac{\partial}{\partial z}a_{z}\right)\cdot(D_{x}a_{x}+D_{y}a_{y}+D_{z}a_{z})
$$
We first consider the dot products of the unit vectors, discarding the six zero terms, and obtain the result that we recognize as the divergence of $\mathbf{D}$:
$$
 \nabla\cdot D=\frac{\partial D_{x}}{\partial x}+\frac{\partial D_{y}}{\partial y}+\frac{\partial D_{z}}{\partial z}=\mathrm{div}(\mathbf{D}) $$
The use of $\nabla\cdot D$ is much more prevalent than that of

[Truncated for analysis]

## Core Ideas

- In rectangular coordinates, $\nabla=\mathbf{a}_x\partial_x+\mathbf{a}_y\partial_y+\mathbf{a}_z\partial_z$.
- The dot operation $\nabla\cdot\mathbf{D}$ produces divergence.
- The result of $\nabla\cdot\mathbf{D}$ is a scalar.
- The gradient $\nabla u$ acts on a scalar and produces a vector.
- The rectangular form of $\nabla$ does not directly generate curvilinear-coordinate formulas.
- In cylindrical coordinates, use the complete cylindrical divergence expression.
- Operator notation and physical divergence notation represent the same operation.

## Source Anchors

- Page 80 defines the rectangular del operator.
- Page 80 expands $\nabla\cdot\mathbf{D}$ and identifies it with $\operatorname{div}\mathbf{D}$.
- Page 80 introduces $\nabla u$ as the gradient of a scalar field.
- Page 80 states that $\nabla\cdot\mathbf{D}$ remains divergence in cylindrical coordinates.
- Page 80 warns that there is no simple standalone form of $\nabla$ supplied there for generating the cylindrical expression.

## Related Pages

- [[divergence-as-local-flux-outflow|Divergence as Local Flux Outflow]]
- [[divergence-in-coordinate-systems|Divergence in Coordinate Systems]]
- [[maxwells-first-equation|Maxwell's First Equation]]
- [[divergence-theorem|Divergence Theorem]]

## Concept Dependencies

- applies-to: [[divergence-as-local-flux-outflow|Divergence as Local Flux Outflow]]
- enables: [[divergence-theorem|Divergence Theorem]]
- enables: [[maxwells-first-equation|Maxwell's First Equation]]
