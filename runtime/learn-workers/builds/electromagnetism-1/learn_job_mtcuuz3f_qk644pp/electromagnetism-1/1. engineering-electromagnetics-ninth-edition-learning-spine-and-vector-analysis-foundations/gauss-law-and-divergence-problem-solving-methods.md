---
title: "1.68 Gauss-Law and Divergence Problem-Solving Methods"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 67", "Page 72", "Page 76", "Page 78", "Page 79", "Page 82", "Page 83", "Page 84", "Page 85"]
related: ["gauss-law-in-integral-form", "choosing-gaussian-surfaces-by-symmetry", "divergence-in-coordinate-systems", "divergence-theorem", "fields-from-layered-charge-distributions"]
---

# 1.68 Gauss-Law and Divergence Problem-Solving Methods

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 67, Page 72, Page 76, Page 78, Page 79, Page 82, Page 83, Page 84, Page 85

The chapter problems turn the core laws into reusable solution tasks. Flux problems require identifying the oriented surface, selecting the normal field component, and integrating with the appropriate area element. Symmetric charge-distribution problems require determining field direction and coordinate dependence, choosing a matching gaussian surface, integrating the enclosed charge, and writing a piecewise field where the charge law changes. Divergence problems require selecting the correct coordinate-system formula and differentiating each field component with its associated geometric factor. Divergence-theorem problems require evaluating both a closed-surface flux integral and a volume integral of divergence, then checking that the results agree. Several problems also reverse the usual direction of reasoning by asking for the charge density that generates a specified field, the surface charge needed to cancel an external field, or the physical interpretation of total flux. Applications extend beyond electrostatics to solar radiation and LED optical power density, showing that surface-flux integration and the divergence theorem are general field-analysis methods.

## Page-Grounded Details

#### Page 67

Figure 3.3 Applying Gauss's law to the field of a point charge $Q$ on a spherical closed surface of radius $\alpha$. The electric flux density $\mathbf{D}$ is everywhere normal to the spherical surface and has a constant magnitude at every point on it.

where the limits on the integrals have been chosen so that the integration is carried over the entire surface of the sphere once. $^{2}$ Integrating gives
$$
\int_{0}^{2\pi}\frac{Q}{4\pi}(-\cos\theta)_{0}^{\pi}\,d\phi=\int_{0}^{2\pi}\frac{Q}{2\pi}d\phi=Q
$$
and we obtain a result showing that $Q$ coulombs of electric flux are crossing the surface, as we should since the enclosed charge is $Q$ coulombs.

D3.3. Given the electric flux density, $\mathbf{D}=0.3r^{2}\mathbf{a}_{r}$, nC/m^2 in free space: ($a$) find $\mathbf{E}$ at point $P(r=2,\theta=25^{\circ},\phi=90^{\circ})$; ($b$) find the total charge within the sphere $r=3$; ($c$) find the total electric flux leaving the sphere $r=4$.

Ans. ($a$) 135.5$\mathbf{a}_{r}$ V/m; ($b$) 305 nC; ($c$) 965 nC

D3.4. Calculate the total electric flux leaving the cubical surface formed by the six planes $x,y,z=\pm 5$ if the charge distribution is: ($ a

[Truncated for analysis]

#### Page 72

An identical result would be obtained for $\rho<a$. Thus the coaxial cable or capacitor has no external field (we have proved that the outer conductor is a "shield"), and there is no field within the center conductor.

Our result is also useful for a finite length of coaxial cable, open at both ends, provided the length L is many times greater than the radius b so that the nonsymmetrical conditions at the two ends do not appreciably affect the solution. Such a device is also termed a coaxial capacitor. Both the coaxial cable and the coaxial capacitor will appear frequently in the work that follows.

#### EXAMPLE 3.2

Let us select a 50-cm length of coaxial cable having an inner radius of 1 mm and an outer radius of 4 mm. The space between conductors is assumed to be filled with air. The total charge on the inner conductor is 30 nC. We wish to know the charge density on each conductor, and the E and D fields.

Solution. We begin by finding the surface charge density on the inner cylinder,
$$
\rho_{S,\text{innercyl}}=\frac{Q_{\text{innercyl}}}{2\pi aL}=\frac{30\times 10^{-9}}{2\pi(10^{-3})(0.5)}=9.55\,\mu\text{C/m}^{2}
$$
The negative charge density on the inner surface of the ou

[Truncated for analysis]

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

## Core Ideas

- For direct flux, compute $\mathbf{D}\cdot d\mathbf{S}$ with the correct orientation.
- For symmetric fields, justify the field components and coordinate dependence first.
- Integrate only charge enclosed by the selected gaussian surface.
- Write separate field expressions for regions separated by charged surfaces or volume boundaries.
- Use $\rho_v=\nabla\cdot\mathbf{D}$ when the field is given and charge density is requested.
- Use the correct rectangular, cylindrical, or spherical divergence formula.
- Check the divergence theorem by evaluating both surface and volume integrals.
- Apply the same flux methods to power-density fields when the source defines a non-electrical flux.

## Source Anchors

- Problems 3.1 through 3.4 on Pages 83 and 84 address shielding, enclosed charge, dipole flux, and spherical flux.
- Problems 3.5 through 3.11 on Page 84 develop planar, spherical, and cylindrical charge-distribution solutions.
- Problem 3.8 on Page 84 asks learners to infer a continuous charge density from an inverse-distance spherical field.
- Problems 3.12 and 3.14 on Pages 84 and 85 apply surface-flux integration to solar radiation and LED power density.
- Problems 3.13, 3.15, and 3.17 on Page 85 require piecewise radial fields and zero-field conditions.
- Problem 3.16 on Page 85 reverses the field problem by asking which charge density generates $\mathbf{D}=D_0\mathbf{a}_\rho$.

## Related Pages

- [[gauss-law-in-integral-form|Gauss's Law in Integral Form]]
- [[choosing-gaussian-surfaces-by-symmetry|Choosing Gaussian Surfaces by Symmetry]]
- [[divergence-in-coordinate-systems|Divergence in Coordinate Systems]]
- [[divergence-theorem|Divergence Theorem]]
- [[fields-from-layered-charge-distributions|Fields from Layered Charge Distributions]]

## Concept Dependencies

- depends-on: [[choosing-gaussian-surfaces-by-symmetry|Choosing Gaussian Surfaces by Symmetry]]
- depends-on: [[divergence-in-coordinate-systems|Divergence in Coordinate Systems]]
- applies-to: [[divergence-theorem|Divergence Theorem]]
