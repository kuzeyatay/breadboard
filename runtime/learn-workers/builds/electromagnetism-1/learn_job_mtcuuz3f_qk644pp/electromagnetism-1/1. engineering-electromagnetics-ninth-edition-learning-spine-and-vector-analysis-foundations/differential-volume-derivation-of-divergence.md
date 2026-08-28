---
title: "1.62 Differential-Volume Derivation of Divergence"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 73", "Page 74", "Page 75", "Figure 3.6", "Example 3.3"]
related: ["divergence-as-local-flux-outflow", "maxwells-first-equation", "divergence-in-coordinate-systems", "divergence-theorem", "gauss-law-in-integral-form"]
---

# 1.62 Differential-Volume Derivation of Divergence

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 73, Page 74, Page 75, Figure 3.6, Example 3.3

To analyze fields without global symmetry, the text applies Gauss's law to a very small rectangular box centered at a point $P$. The box has side lengths $\Delta x$, $\Delta y$, and $\Delta z$. The field on each face is approximated using the constant and first-derivative terms of a Taylor expansion. On the front and back faces, for example, $D_x$ is approximated by $D_{x0}\pm(\Delta x/2)(\partial D_x/\partial x)$. Because the outward normals on opposite faces have opposite directions, the constant terms cancel when their fluxes are added. The remaining net flux through the pair is $(\partial D_x/\partial x)\Delta x\Delta y\Delta z$. Repeating this for the other two face pairs produces analogous terms involving $D_y$ and $D_z$. The total outward flux is therefore approximately $[\partial D_x/\partial x+\partial D_y/\partial y+\partial D_z/\partial z]\Delta v$, where $\Delta v=\Delta x\Delta y\Delta z$. This derivation reveals that local changes in each matching field component determine the net flux from a small volume.

## Page-Grounded Details

#### Page 73

#### 3.4 Gauss's Law in Differential Form: Divergence

We will now apply the methods of Gauss's law to a slightly different type of problem-one that may not possess any symmetry at all. At first glance, it might seem that our case is hopeless, for without symmetry, a simple gaussian surface cannot be chosen such that the normal component of $\mathbf{D}$ is constant or zero everywhere on the surface. Without such a surface, the integral cannot be evaluated. There is only one way to circumvent these difficulties and that is to choose such a very small closed surface that $\mathbf{D}$ is almost constant over the surface, and the small change in $\mathbf{D}$ may be adequately represented by using the first two terms of the Taylor's-series expansion for $\mathbf{D}$. The result will become more nearly correct as the volume enclosed by the gaussian surface decreases, and we intend eventually to allow this volume to approach zero.

This example also differs from the preceding ones in that we will not obtain the value of $\mathbf{D}$ as our answer but will instead receive some extremely valuable information about the way $\mathbf{D}$ varies in the region of our small surface. T

[Truncated for analysis]

#### Page 74

Figure 3.6 A differential-sized gaussian surface about the point P is used to investigate the space rate of change of D in the neighborhood of P.

where $D_{x0}$ is the value of $D_{x}$ at $P$, and where a partial derivative must be used to express the rate of change of $D_{x}$ with $x$, as $D_{x}$ in general also varies with $y$ and $z$. This expression could have been obtained more formally by using the constant term and the term involving the first derivative in the Taylor's-series expansion for $D_{x}$ in the neighborhood of $P$.

We now have
$$
\int_{\rm front}\doteq\left(D_{x0}+\frac{\Delta x}{2}\frac{\partial D_{x}}{\partial x}\right)\Delta y\,\Delta z
$$
Consider now the integral over the back surface,
$$
\begin{align*}\int_{\rm back}&=\mathbf{D}_{\rm back}\cdot\Delta\mathbf{S}_{\rm back}\\ &=\mathbf{D}_{\rm back}\cdot\left(-\Delta y\,\Delta z\,\mathbf{a}_{x}\right)\\ &=-D_{x,\rm back}\,\Delta y\,\Delta z\end{align*}
$$
and
$$
D_{x,\rm back}=D_{x0}-\frac{\Delta x}{2}\frac{\partial D_{x}}{\partial x}
$$
giving
$$
\int_{\rm back}\doteq\left(-D_{x0}+\frac{\Delta x}{2}\frac{\partial D_{x}}{\partial x}\right)\Delta y\,\Delta z
$$
#### Page 75

If we combine these two integrals,we have
$$
\int_{\text {front}}+\int_{\text {back}}=\frac{\partial D_{x}}{\partial x}\Delta x\,\Delta y\,\Delta z
$$
 By exactly the same process we find that
$$
\int_{\text {right}}+\int_{\text {left}}=\frac{\partial D_{y}}{\partial y}\Delta x\,\Delta y\,\Delta z
$$
 and
$$
\int_{\text {top}}+\int_{\text {bottom}}=\frac{\partial D_{z}}{\partial z}\Delta x\,\Delta y\,\Delta z
$$
 and these results may be collected to yield
$$
\oint_{S}\mathbf{D}\cdot d\mathbf{S}=Q=\left(\frac{\partial D_{x}}{\partial x}+\frac{\partial D_{y}}{\partial y}+\frac{\partial D_{z}}{\partial z}\right)\Delta v\qquad(7)
$$
 where $\Delta v=\Delta x\Delta y\Delta z$. The expression is an approximation which becomes better as $\Delta v$ becomes smaller, and in the following section we shall let the volume $\Delta v$ approach zero. For the moment, we have applied Gauss's law to the closed surface surrounding the volume element $\Delta v$ and have as a result the approximation (7) stating that
$$ \text{Charge enclosedinvolume}\Delta v=\left(\frac{\partial D_{x}}{\partial x}+\frac{\partial D_{y}}{\partial y}+\frac{\partial D_{z}}{\partial z}\right)\times\text {vo

[Truncated for analysis]

## Core Ideas

- Use a small rectangular gaussian box centered at the evaluation point.
- Break the closed-surface integral into six face integrals.
- Use outward normals with opposite signs on opposing faces.
- Approximate face values with first-order Taylor expansions.
- Opposite-face constant field terms cancel.
- The front and back pair contributes $(\partial D_x/\partial x)\Delta v$.
- The other pairs contribute $(\partial D_y/\partial y)\Delta v$ and $(\partial D_z/\partial z)\Delta v$.
- The approximation becomes exact in the zero-volume limit.

## Source Anchors

- Page 73 introduces a small box of dimensions $\Delta x$, $\Delta y$, and $\Delta z$ centered at $P$.
- Pages 73 and 74 approximate front and back values using $D_{x0}\pm(\Delta x/2)(\partial D_x/\partial x)$.
- Page 75 combines opposite-face fluxes to obtain one derivative term per coordinate direction.
- Page 75 gives $Q=[\partial D_x/\partial x+\partial D_y/\partial y+\partial D_z/\partial z]\Delta v$.
- S1.P74.F1 depicts the differential gaussian surface and the field variation around point $P$.
- Example 3.3 on Page 75 estimates $2$ nC in a volume of $10^{-9}\,\mathrm{m^3}$ at the origin.

## Related Pages

- [[divergence-as-local-flux-outflow|Divergence as Local Flux Outflow]]
- [[maxwells-first-equation|Maxwell's First Equation]]
- [[divergence-in-coordinate-systems|Divergence in Coordinate Systems]]
- [[divergence-theorem|Divergence Theorem]]
- [[gauss-law-in-integral-form|Gauss's Law in Integral Form]]

## Concept Dependencies

- derives-from: [[gauss-law-in-integral-form|Gauss's Law in Integral Form]]
- enables: [[divergence-as-local-flux-outflow|Divergence as Local Flux Outflow]]
- enables: [[maxwells-first-equation|Maxwell's First Equation]]
