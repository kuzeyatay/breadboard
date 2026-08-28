---
title: "1.63 Divergence as Local Flux Outflow"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 76", "Page 77", "Page 78", "Example 3.4"]
related: ["differential-volume-derivation-of-divergence", "divergence-in-coordinate-systems", "maxwells-first-equation", "del-operator-and-divergence-notation"]
---

# 1.63 Divergence as Local Flux Outflow

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 76, Page 77, Page 78, Example 3.4

Divergence is defined for a vector field $\mathbf{A}$ as the net outward flux through a shrinking closed surface divided by the enclosed volume: $\operatorname{div}\mathbf{A}=\lim_{\Delta v\to0}[\oint_S\mathbf{A}\cdot d\mathbf{S}]/\Delta v$. It is a scalar measure of how strongly the field behaves as a source or sink at a point. Positive divergence indicates net local outflow, negative divergence indicates net local inflow, and zero divergence indicates no net source or sink within the differential volume. The text illustrates zero divergence using incompressible water away from the moving free surface and positive divergence using expanding air in a punctured tire. Divergence has no direction, despite being calculated from a vector field. For electric flux density measured in $\mathrm{C/m^2}$, divergence has units $\mathrm{C/m^3}$, matching volume charge density. Example 3.4 calculates the divergence of $\mathbf{D}=e^{-x}\sin y\,\mathbf{a}_x-e^{-x}\cos y\,\mathbf{a}_y+2z\,\mathbf{a}_z$ and finds the constant value $2$ because the first two derivative terms cancel.

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

#### Page 77

is essentially incompressible, and the water entering and leaving different regions of the closed surface must be equal. Hence the divergence of this velocity is zero.

If, however, we consider the velocity of the air in a tire that has just been punctured by a nail, we realize that the air is expanding as the pressure drops, and that consequently there is a net outflow from any closed surface lying within the tire. The divergence of this velocity is therefore greater than zero.

A positive divergence for any vector quantity indicates a source of that vector quantity at that point. Similarly, a negative divergence indicates a sink. Because the divergence of the water velocity above is zero, no source or sink exists.$^{3}$ The expanding air, however, produces a positive divergence of the velocity, and each interior point may be considered a source.

Writing (9) with our new term, we have
$$
div\mathbf{D}=\left(\frac{\partial D_{x}}{\partial x}+\frac{\partial D_{y}}{\partial y}+\frac{\partial D_{z}}{\partial z}\right)\quad{(rectangular)}\quad{(12)}
$$
This expression is again of a form that does not involve the charge density. It is the result of applying the definition of diverg

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

## Core Ideas

- Divergence is outward flux per unit volume in the zero-volume limit.
- Divergence acts on a vector field and produces a scalar.
- Positive divergence indicates a local source.
- Negative divergence indicates a local sink.
- Zero divergence indicates no net local source or sink.
- Divergence has no associated direction or unit vector.
- For $\mathbf{D}$ in $\mathrm{C/m^2}$, divergence has units $\mathrm{C/m^3}$.

## Source Anchors

- Page 76 defines $\operatorname{div}\mathbf{A}=\lim_{\Delta v\to0}\oint_S\mathbf{A}\cdot d\mathbf{S}/\Delta v$.
- Pages 76 and 77 interpret divergence as flux outflow per unit volume.
- Page 77 uses incompressible bathtub water as a zero-divergence example.
- Page 77 uses expanding air in a punctured tire as a positive-divergence example.
- Page 78 warns that divergence is a scalar and carries no direction.
- Example 3.4 on Page 78 obtains $\operatorname{div}\mathbf{D}=2$ everywhere.

## Related Pages

- [[differential-volume-derivation-of-divergence|Differential-Volume Derivation of Divergence]]
- [[divergence-in-coordinate-systems|Divergence in Coordinate Systems]]
- [[maxwells-first-equation|Maxwell's First Equation]]
- [[del-operator-and-divergence-notation|Del Operator and Divergence Notation]]

## Concept Dependencies

- related: [[divergence-in-coordinate-systems|Divergence in Coordinate Systems]]
- applies-to: [[maxwells-first-equation|Maxwell's First Equation]]
- related: [[del-operator-and-divergence-notation|Del Operator and Divergence Notation]]
