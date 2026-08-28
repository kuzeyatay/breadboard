---
title: "1.64 Divergence in Coordinate Systems"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 77", "Page 78", "Page 79", "Page 85"]
related: ["divergence-as-local-flux-outflow", "maxwells-first-equation", "del-operator-and-divergence-notation", "fields-from-layered-charge-distributions", "gauss-law-and-divergence-problem-solving-methods"]
---

# 1.64 Divergence in Coordinate Systems

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 77, Page 78, Page 79, Page 85

The explicit formula for divergence depends on the coordinate system because differential volumes and surface areas have different scale factors. In rectangular coordinates, $\operatorname{div}\mathbf{D}=\partial D_x/\partial x+\partial D_y/\partial y+\partial D_z/\partial z$. In cylindrical coordinates, the radial expansion of area introduces the factor $\rho$, giving $\operatorname{div}\mathbf{D}=(1/\rho)\partial(\rho D_\rho)/\partial\rho+(1/\rho)\partial D_\phi/\partial\phi+\partial D_z/\partial z$. In spherical coordinates, radial and angular area changes give $\operatorname{div}\mathbf{D}=(1/r^2)\partial(r^2D_r)/\partial r+[1/(r\sin\theta)]\partial(\sin\theta D_\theta)/\partial\theta+[1/(r\sin\theta)]\partial D_\phi/\partial\phi$. The correct formula must be selected before differentiating. One differentiates the component paired with each coordinate, including the geometric factors shown. Exercises ask for numerical divergence at points in all three systems and for volume charge density derived from specified fields, reinforcing that the coordinate-system formula is part of the calculation rather than an optional notation change.

## Page-Grounded Details

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

#### Page 85

assume uniform radiation, (a) what power is radiated by the region lying between latitude 50 degN and 60 degN and longitude 12 degW and 27 degW? (b) What is the power density on a spherical surface 93,000,000 miles from the sun in $\mathrm{W/m^{2}}$?

3.13

Spherical surfaces at r = 2, 4, and 6 m carry uniform surface charge densities of 20 nC/m^2, -4 nC/m^2, and $\rho_{SO}$, respectively. (a) Find D at r = 1, 3, and 5 m. (b) Determine $\rho_{SO}$ such that D = 0 at r = 7 m.

3.14

A certain light-emitting diode (LED) is centered at the origin with its surface in the xy plane. At far distances, the LED appears as a point, but the glowing surface geometry produces a far-field radiation pattern that follows a raised cosine law: that is, the optical power (flux) density in $\mathrm{W/m^{2}}$ is given in spherical coordinates by
$$
P_{d}=P_{0}\frac{\cos^{2}\theta}{2\pi r^{2}}a_{r}\quad\mathrm{W/m^{2}}
$$
where $\theta$ is the angle measured with respect to the direction that is normal to the LED surface (in this case, the z axis), and r is the radial distance from the origin at which the power is detected. (a) In terms of $P_{0}$, find the total power in watts emitted in

[Truncated for analysis]

## Core Ideas

- Rectangular divergence is $\partial D_x/\partial x+\partial D_y/\partial y+\partial D_z/\partial z$.
- Cylindrical radial divergence uses $(1/\rho)\partial(\rho D_\rho)/\partial\rho$.
- Cylindrical azimuthal divergence uses $(1/\rho)\partial D_\phi/\partial\phi$.
- Spherical radial divergence uses $(1/r^2)\partial(r^2D_r)/\partial r$.
- Spherical polar divergence includes $\sin\theta$ inside the derivative.
- Coordinate scale factors must not be omitted.
- The result remains a scalar in every coordinate system.

## Source Anchors

- Page 77 gives the rectangular-coordinate divergence formula.
- Page 77 gives the cylindrical-coordinate divergence formula.
- Page 77 gives the spherical-coordinate divergence formula.
- Problem D3.7 on Page 78 requires divergence calculations in rectangular, cylindrical, and spherical coordinates.
- Problem D3.8 on Page 79 asks for volume charge density from fields expressed in all three coordinate systems.
- Problem 3.16 on Page 85 asks for the charge density associated with a constant radial cylindrical flux density.

## Related Pages

- [[divergence-as-local-flux-outflow|Divergence as Local Flux Outflow]]
- [[maxwells-first-equation|Maxwell's First Equation]]
- [[del-operator-and-divergence-notation|Del Operator and Divergence Notation]]
- [[fields-from-layered-charge-distributions|Fields from Layered Charge Distributions]]
- [[gauss-law-and-divergence-problem-solving-methods|Gauss-Law and Divergence Problem-Solving Methods]]

## Concept Dependencies

- depends-on: [[divergence-as-local-flux-outflow|Divergence as Local Flux Outflow]]
- applies-to: [[maxwells-first-equation|Maxwell's First Equation]]
- enables: [[gauss-law-and-divergence-problem-solving-methods|Gauss-Law and Divergence Problem-Solving Methods]]
