---
title: "1.56 Spherical Gaussian Surface for a Point Charge"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 66", "Page 67", "Page 68", "Page 69", "Page 84", "Page 85", "Figure 3.3"]
related: ["gauss-law-in-integral-form", "choosing-gaussian-surfaces-by-symmetry", "maxwells-first-equation", "fields-from-layered-charge-distributions"]
---

# 1.56 Spherical Gaussian Surface for a Point Charge

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 66, Page 67, Page 68, Page 69, Page 84, Page 85, Figure 3.3

A point charge at the origin produces a radially directed field with spherical symmetry. A sphere centered at the charge is therefore the natural gaussian surface because $\mathbf{D}$ is normal to the sphere and has the same magnitude at every point on it. For a sphere of radius $r$, Gauss's law reduces to $Q=D_r\oint_S dS=D_r(4\pi r^2)$. Solving gives $D_r=Q/(4\pi r^2)$ and hence $\mathbf{D}=Q\mathbf{a}_r/(4\pi r^2)$. In free space, $\mathbf{E}=\mathbf{D}/\epsilon_0$, so $\mathbf{E}=Q\mathbf{a}_r/(4\pi\epsilon_0r^2)$. Example 3.1 verifies the result by explicitly integrating the spherical area element $d\mathbf{S}=r^2\sin\theta\,d\theta\,d\phi\,\mathbf{a}_r$ over $0\leq\theta\leq\pi$ and $0\leq\phi\leq2\pi$. The calculation yields total flux $Q$, independently of the sphere radius. This demonstrates both the inverse-square dependence and the conservation of total flux through concentric spheres.

## Page-Grounded Details

#### Page 66

or a line charge,
$$
Q=\int\rho_{L}dL
$$
or a surface charge,
$$
Q=\int_{S}\rho_{S}dS\qquad(\text{not necessarilyaclosedsurface})
$$
or a volume charge distribution,
$$
Q=\int_{\text{vol}}\rho_{v}dv
$$
The last form is usually used, and we should agree now that it represents any or all of the other forms. With this understanding, Gauss's law may be written in terms of the charge distribution as
$$
\oint_{S}\mathbf{D}_{S}\cdot d\mathbf{S}=\int_{\text{vol}}\rho_{v}dv\qquad(6)
$$
a mathematical statement meaning simply that the total electric flux through any closed surface is equal to the charge enclosed.

#### Example 3.1

To illustrate the application of Gauss's law, let us check the results of Faraday's experiment by placing a point charge Q at the origin of a spherical coordinate system(Figure 3.3) and by choosing our closed surface as a sphere of radius a.

Solution. We have, as before,
$$
D=\frac{Q}{4\pi r^{2}}a_{r}
$$
At the surface of the sphere,
$$
D_{S}=\frac{Q}{4\pi a^{2}}a_{r}
$$
The differential element of area on a spherical surface is, in spherical coordinates from Chapter 1,
$$
dS=r^{2}\sin\theta\,d\theta\,d\phi=a^{2}\sin\theta\,d\theta\,d\phi
$$
or
$$
[Truncated for analysis]

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

#### Page 68

#### 3.3 APPLICATION OF GAUSS'S LAW: SOME SYMMETRICAL CHARGE DISTRIBUTIONS

We now consider how we may use Gauss's law
$$
 Q=\oint_{S}\mathbf{D}_{S}\cdot d\mathbf{S} $$
to determine $\mathbf{D}_{S}$ if the charge distribution is known. This is an example of an integral equation in which the unknown quantity to be determined appears inside the integral.

The solution is easy if we can choose a closed surface which satisfies two conditions:

1. $\mathbf{D}_{S}$ is everywhere either normal or tangential to the closed surface, so that $\mathbf{D}_{S}$ or becomes either $D_{S}dS$ or zero, respectively.

2. On that portion of the closed surface for which $\mathbf{D}_{S}\cdot d\mathbf{S}$ is not zero, $D_{S}$ = constant.

This allows the dot product to be replaced with the product of the scalars $D_{S}$ and $dS$, and then $D_{S}$ can be brought outside the integral sign. The remaining integral is then $\int_{S}dS$ over that portion of the closed surface that $\mathbf{D}_{S}$ crosses normally, and this is simply the area of this section of that surface. Only a knowledge of the symmetry of the problem enables us to choose such a closed surface.

#### 3.3.1 Point Char

[Truncated for analysis]

#### Page 69

which agrees with the results of Chapter 2. The example is a trivial one, and the objection could be raised that we had to know that the field was symmetrical and directed radially outward before we could obtain an answer. This is true, and that leaves the inverse-square-law relationship as the only check obtained from Gauss's law. The example does, however, serve to illustrate a method which can be applied to other problems, including several to which Coulomb's law is almost incapable of supplying an answer.

#### 3.3.2 Line Charge Field

As a second example, consider again the uniform line charge distribution $\rho_{L}$ lying along the z axis and extending from $-\infty$ to $+\infty$. We must first know the symmetry of the field, and this knowledge is complete when the answers to these two questions are known:

1. With which coordinates does the field vary (or of what variables is D a function)?

2. Which components of D are present?

In using Gauss's law, it is not a question of using symmetry to simplify the solution, for the application of Gauss's law depends on symmetry, and if we cannot show that symmetry exists then we cannot use Gauss's law to obtain a solution. The

[Truncated for analysis]

## Core Ideas

- Spherical symmetry implies $\mathbf{D}=D_r(r)\mathbf{a}_r$.
- A centered sphere makes $\mathbf{D}$ normal and constant in magnitude over the surface.
- The sphere area is $4\pi r^2$.
- Gauss's law gives $D_r=Q/(4\pi r^2)$.
- In free space, $\mathbf{E}=Q\mathbf{a}_r/(4\pi\epsilon_0r^2)$.
- The total flux through every centered sphere enclosing the charge is $Q$.
- The field magnitude decreases as $1/r^2$ while spherical area increases as $r^2$.

## Source Anchors

- Example 3.1 on Pages 66 and 67 uses a spherical surface of radius $a$ around a point charge at the origin.
- Page 66 gives $d\mathbf{S}=a^2\sin\theta\,d\theta\,d\phi\,\mathbf{a}_r$.
- Page 67 evaluates the complete spherical integral and obtains $Q$.
- Pages 68 and 69 derive $Q=4\pi r^2D_S$ and $\mathbf{D}=Q\mathbf{a}_r/(4\pi r^2)$.
- S1.P67.F1 shows that $\mathbf{D}$ is normal to the spherical surface and constant in magnitude on it.
- Problems 3.7, 3.9, 3.13, and 3.17 on Pages 84 and 85 extend the method to spherically symmetric volume and surface charge distributions.

## Related Pages

- [[gauss-law-in-integral-form|Gauss's Law in Integral Form]]
- [[choosing-gaussian-surfaces-by-symmetry|Choosing Gaussian Surfaces by Symmetry]]
- [[maxwells-first-equation|Maxwell's First Equation]]
- [[fields-from-layered-charge-distributions|Fields from Layered Charge Distributions]]

## Concept Dependencies

- example-of: [[choosing-gaussian-surfaces-by-symmetry|Choosing Gaussian Surfaces by Symmetry]]
- applies-to: [[gauss-law-in-integral-form|Gauss's Law in Integral Form]]
- related: [[maxwells-first-equation|Maxwell's First Equation]]
