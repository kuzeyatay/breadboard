---
title: "1.65 Maxwell's First Equation"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 76", "Page 78", "Page 79"]
related: ["gauss-law-in-integral-form", "differential-volume-derivation-of-divergence", "divergence-as-local-flux-outflow", "divergence-theorem", "spherical-gaussian-surface-for-a-point-charge"]
---

# 1.65 Maxwell's First Equation

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 76, Page 78, Page 79

Taking the differential-volume limit of Gauss's law identifies the local divergence of electric flux density with volume charge density. The result is $\operatorname{div}\mathbf{D}=\rho_v$, or equivalently $\nabla\cdot\mathbf{D}=\rho_v$. This is the point form and differential-equation form of Gauss's law. It states that the electric flux leaving a vanishingly small volume per unit volume equals the charge density at that point. The integral form describes the total flux and charge over a finite region, while the point form describes their local relationship. Applied to the point-charge field $\mathbf{D}=Q\mathbf{a}_r/(4\pi r^2)$, the spherical divergence formula gives zero for every $r\neq0$ because $r^2D_r$ is constant. The charge density is therefore zero away from the origin and singular at the origin, where the point charge is located. This example is an important warning: a field can have nonzero flux through an enclosing surface even though its ordinary divergence is zero at every nonsingular point inside the surrounding region.

## Page-Grounded Details

#### Page 76

D3.6. In free space, let $\mathbf{D}=8xyz^{4}\mathbf{a}_{x}+4x^{2}z^{4}\mathbf{a}_{y}+16x^{2}yz^{3}\mathbf{a}_{z}$ pC/m^2. (a) Find the total electric flux passing through the rectangular surface $z=2$, $0<x<2$, $1<y<3$, in the $\mathbf{a}_{z}$ direction. (b) Find E at P(2, -1, 3). (c) Find an approximmate value for the total charge contained in an incremental sphere located at P(2, -1, 3) and having a volume of $10^{-12}$ m^3.

Ans. (a) 1365 pC; (b) -146.4$\mathbf{a}_{x}$ + 146.4$\mathbf{a}_{y}$ - 195.2$\mathbf{a}_{z}$ V/m; (c) -2.38 x $10^{-21}$ C

#### 3.4.2 Divergence

We next obtain an exact relationship from (7), by allowing the volume element $\Delta v$ to shrink to zero. We write this equation as
$$
\left(\frac{\partial D_{x}}{\partial x}+\frac{\partial D_{y}}{\partial y}+\frac{\partial D_{z}}{\partial z}\right)=\lim_{\Delta v\to 0}\frac{\oint_{S}\mathbf{D}\cdot d\mathbf{S}}{\Delta v}=\lim_{\Delta v\to 0}\frac{Q}{\Delta v}=\rho_{v}\quad{(9)}
$$
in which the charge density, $\rho_{v}$, is identified in the second equality.

The methods of the previous section could have been used on any vector $\mathbf{A}$ to find $ \oint_{S}\mathbf{A}\cdot d\math

[Truncated for analysis]

#### Page 78

the partial derivatives. Divergence merely tells us _how much_ flux is leaving a small volume on a per-unit-volume basis; no direction is associated with it.

We can illustrate the concept of divergence by continuing with the example at the end of Section 3.4.

EXAMPLE 3.4

Find $\mathrm{div}\,{\bf D}$ at the origin if ${\bf D}=e^{-x}\sin y\,{\bf a}x - e^{-x}\cos y\,{\bf a}_{y} + 2z\,{\bf a}_{z}$.

Solution. We use (10) to obtain
$$
\begin{array}[]{rl}\mathrm{div}\,{\bf D}&=\frac{\partial D_{x}}{\partial x}+\frac{\partial D_{y}}{\partial y}+\frac{\partial D_{z}}{\partial z}\\ &=&-e^{-x}\sin y + e^{-x}\sin y + 2 = 2\end{array}
$$
The value is the constant 2, regardless of location.

If the units of D are $C/m^{2}$, then the units of $\mathrm{div}\,{\bf D}$ are $C/m^{3}$. This is a volume charge density, a concept discussed in the next section.

D3.7. In each of the following parts, find a numerical value for $\mathrm{div}\,{\bf D}$ at the point specified: (a) ${\bf D}=(2xyz - y^{2}){\bf a}_{x} + (x^{2}z - 2xy){\bf a}_{y} + x^{2}y{\bf a}_{z}\,C/m^{2}$ at $P_{A}(2,3,-1)$; (b) $ {\bf D}=2\rho z^{2}\sin^{2}\phi\,{\bf a}_{\rho}+\rho z^{2}\sin 2\phi\,{\bf a}_{\phi}+2\rho

[Truncated for analysis]

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

## Core Ideas

- Maxwell's first equation is $\nabla\cdot\mathbf{D}=\rho_v$.
- It is the point form of Gauss's law.
- It is also the differential-equation form of Gauss's law.
- The integral form applies to a finite closed surface and enclosed volume.
- The point form relates local flux outflow to local volume charge density.
- For a point charge, $\nabla\cdot\mathbf{D}=0$ when $r\neq0$.
- The point charge produces a singular charge density at the origin.

## Source Anchors

- Page 76 identifies the zero-volume flux ratio with $\rho_v$.
- Page 78 states $\operatorname{div}\mathbf{D}=\rho_v$ as Maxwell's first equation.
- Page 78 describes the equation as both point form and differential-equation form.
- Page 79 applies spherical divergence to $\mathbf{D}=Q\mathbf{a}_r/(4\pi r^2)$.
- Page 79 obtains zero divergence for $r\neq0$ and states that charge density is infinite at the origin.
- Problem D3.8 on Page 79 asks learners to determine $\rho_v$ from given $\mathbf{D}$ fields.

## Related Pages

- [[gauss-law-in-integral-form|Gauss's Law in Integral Form]]
- [[differential-volume-derivation-of-divergence|Differential-Volume Derivation of Divergence]]
- [[divergence-as-local-flux-outflow|Divergence as Local Flux Outflow]]
- [[divergence-theorem|Divergence Theorem]]
- [[spherical-gaussian-surface-for-a-point-charge|Spherical Gaussian Surface for a Point Charge]]

## Concept Dependencies

- related: [[gauss-law-in-integral-form|Gauss's Law in Integral Form]]
- enables: [[divergence-theorem|Divergence Theorem]]
- applies-to: [[spherical-gaussian-surface-for-a-point-charge|Spherical Gaussian Surface for a Point Charge]]
