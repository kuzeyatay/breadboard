---
title: "1.58 Infinite Uniform Line Charge Field"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 69", "Page 70", "Page 84", "Page 85", "Figure 3.4"]
related: ["choosing-gaussian-surfaces-by-symmetry", "coaxial-cable-field-and-electrostatic-shielding", "fields-from-layered-charge-distributions", "gauss-law-in-integral-form"]
---

# 1.58 Infinite Uniform Line Charge Field

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 69, Page 70, Page 84, Page 85, Figure 3.4

An infinite uniform line charge on the $z$ axis has cylindrical symmetry. Translation along $z$ and rotation about the axis cannot change the field, so the electric flux density has only a radial cylindrical component and depends only on radial distance: $\mathbf{D}=D_\rho(\rho)\mathbf{a}_\rho$. A right circular cylinder of radius $\rho$ and length $L$, coaxial with the line, is chosen as the gaussian surface. The field is normal and constant on the curved side, while it is parallel to the end faces, so the end-face flux is zero. The total flux is therefore $D_\rho(2\pi\rho L)$. The enclosed charge is $Q=\rho_LL$, where $\rho_L$ is the line charge density. Equating flux and charge gives $D_\rho=\rho_L/(2\pi\rho)$ and, in free space, $E_\rho=\rho_L/(2\pi\epsilon_0\rho)$. The field decreases as $1/\rho$ because the area of the cylindrical side grows linearly with radius. This derivation illustrates how symmetry converts a surface integral into multiplication by the lateral area.

## Page-Grounded Details

#### Page 69

which agrees with the results of Chapter 2. The example is a trivial one, and the objection could be raised that we had to know that the field was symmetrical and directed radially outward before we could obtain an answer. This is true, and that leaves the inverse-square-law relationship as the only check obtained from Gauss's law. The example does, however, serve to illustrate a method which can be applied to other problems, including several to which Coulomb's law is almost incapable of supplying an answer.

#### 3.3.2 Line Charge Field

As a second example, consider again the uniform line charge distribution $\rho_{L}$ lying along the z axis and extending from $-\infty$ to $+\infty$. We must first know the symmetry of the field, and this knowledge is complete when the answers to these two questions are known:

1. With which coordinates does the field vary (or of what variables is D a function)?

2. Which components of D are present?

In using Gauss's law, it is not a question of using symmetry to simplify the solution, for the application of Gauss's law depends on symmetry, and if we cannot show that symmetry exists then we cannot use Gauss's law to obtain a solution. The

[Truncated for analysis]

#### Page 70

Figure 3.4 The gaussian surface for an infinite uniform line charge is a right circular cylinder of length $L$ and radius $\rho$. $\mathbf{D}$ is constant in magnitude and everywhere perpendicular to the cylindrical surface; $\mathbf{D}$ is parallel to the end faces.

giving
$$
D_{\rho}=\frac{\rho_{L}}{2\pi\rho}
$$
or
$$
E_{\rho}=\frac{\rho_{L}}{2\pi\,\epsilon_{0}\rho}
$$
Comparing with Section 2.4, Eq. (16), shows that the correct result has been obtained and with much less work. Once the appropriate surface has been chosen, the integration usually amounts only to writing down the area of the surface at which $\mathbf{D}$ is normal.

#### 3.3.3 Coaxial Cable Field

The problem of a coaxial cable is almost identical to that of the line charge and is an example that is extremely difficult to solve from the standpoint of Coulomb's law. Suppose that we have two coaxial cylindrical conductors, the inner of radius $a$ and the outer of radius $b$, each infinite in extent (Figure 3.5). We will assume a charge distribution of $\rho_{S}$ on the outer surface of the inner conductor.

Symmetry considerations show us that only the $D_{\rho}$ component is present and that

[Truncated for analysis]

#### Page 84

3.4

An electric field in free space is $\mathbf{E}=(5z^{3}/\epsilon_{0})\hat{\mathbf{a}}_{z}$ V/m. Find the total charge contained within a sphere of 3-m radius, centered at the origin.

3.5

A volume charge distribution in free space is characterized by the density
$$
\rho_{v}=\frac{q}{2Ad}\exp(-|z|/d)
$$
where d is a distance along z, A is the area of a surface parallel to the xy plane, and q is a fixed charge quantity. The charge distribution exists everywhere. (a) Find the electric field intensity, $\mathbf{E}$, everywhere. (b) What is the interpretation of q?

3.6

In free space, a volume charge of constant density $\rho_{v}=\rho_{0}$ exists within the region $-\infty<x<\infty$, $-\infty<y<\infty$, and $-d/2<z<d/2$. Find $\mathbf{D}$ and $\mathbf{E}$ everywhere.

3.7

A spherically symmetric charge distribution in free space is characterized by the charge density
$$
\rho_{v}=\frac{qb}{r^{2}}\exp(-br)\quad\mathrm{C/m^{3}}\quad(0<r<\infty)
$$
(a) Find the electric field intensity, $\mathbf{E}(r)$, everywhere. (b) Find the total charge present.

3.8

Use Gauss's law in integral form to show that an inverse distance field in spherical coordinates, $ \mathbf{

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

- The field has the form $\mathbf{D}=D_\rho(\rho)\mathbf{a}_\rho$.
- A coaxial cylindrical gaussian surface matches the symmetry.
- The curved side has area $2\pi\rho L$.
- The field is parallel to the top and bottom faces, so their flux is zero.
- The enclosed line charge is $Q=\rho_LL$.
- The flux density is $\mathbf{D}=\rho_L\mathbf{a}_\rho/(2\pi\rho)$.
- In free space, $\mathbf{E}=\rho_L\mathbf{a}_\rho/(2\pi\epsilon_0\rho)$.

## Source Anchors

- Page 69 identifies $\mathbf{D}=D_\rho\mathbf{a}_\rho$ and $D_\rho=f(\rho)$.
- Pages 69 and 70 calculate $Q=D_S2\pi\rho L$ for a cylindrical gaussian surface.
- Page 70 substitutes $Q=\rho_LL$ to obtain $D_\rho=\rho_L/(2\pi\rho)$.
- S1.P70.F1 shows radial $\mathbf{D}$ normal to the cylinder side and parallel to both end faces.
- Problems 3.10, 3.11, 3.15, and 3.16 on Pages 84 and 85 apply cylindrical symmetry to distributed charge.

## Related Pages

- [[choosing-gaussian-surfaces-by-symmetry|Choosing Gaussian Surfaces by Symmetry]]
- [[coaxial-cable-field-and-electrostatic-shielding|Coaxial Cable Field and Electrostatic Shielding]]
- [[fields-from-layered-charge-distributions|Fields from Layered Charge Distributions]]
- [[gauss-law-in-integral-form|Gauss's Law in Integral Form]]

## Concept Dependencies

- related: [[coaxial-cable-field-and-electrostatic-shielding|Coaxial Cable Field and Electrostatic Shielding]]
- applies-to: [[gauss-law-in-integral-form|Gauss's Law in Integral Form]]
