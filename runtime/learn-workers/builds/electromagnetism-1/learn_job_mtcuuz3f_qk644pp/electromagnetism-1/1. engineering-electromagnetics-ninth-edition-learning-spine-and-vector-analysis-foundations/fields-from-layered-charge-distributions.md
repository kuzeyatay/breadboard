---
title: "1.61 Fields from Layered Charge Distributions"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 72", "Page 84", "Page 85"]
related: ["spherical-gaussian-surface-for-a-point-charge", "infinite-uniform-line-charge-field", "coaxial-cable-field-and-electrostatic-shielding", "choosing-gaussian-surfaces-by-symmetry"]
---

# 1.61 Fields from Layered Charge Distributions

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 72, Page 84, Page 85

Several exercises generalize Gauss's law to concentric spherical surfaces, cylindrical shells, and distributed volume charge. The reusable procedure is to divide space into radial regions, choose a gaussian surface consistent with the symmetry, calculate only the charge enclosed at that radius, and solve for the radial field. Crossing a charged shell changes the enclosed charge and therefore changes the field expression, while charges on shells outside the gaussian surface do not contribute to its enclosed-charge total. For spherical symmetry, $D_r4\pi r^2=Q_{\mathrm{enc}}(r)$. For cylindrical symmetry over length $L$, $D_\rho2\pi\rho L=Q_{\mathrm{enc}}(\rho)$. When charge is distributed through volume, the enclosed charge must first be integrated using the correct differential volume. Additional surface charge can be selected so that total enclosed charge vanishes beyond a specified radius, producing zero external field. This regional method underlies the exercises involving concentric charged spheres, charged cylindrical dielectrics, gaussian radial charge profiles, annular volume charge, and surfaces on which the electric field vanishes.

## Page-Grounded Details

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

- Partition the geometry at every radius where the charge law changes.
- Calculate $Q_{\mathrm{enc}}$ separately in each radial region.
- Use $D_r=Q_{\mathrm{enc}}/(4\pi r^2)$ for spherical symmetry.
- Use $D_\rho=Q_{\mathrm{enc}}/(2\pi\rho L)$ for cylindrical symmetry.
- Ignore charge outside the selected gaussian surface when forming $Q_{\mathrm{enc}}$.
- Include point, surface, and volume contributions inside the surface.
- Set total enclosed charge to zero when designing a zero external field.
- State the final field as a piecewise function.

## Source Anchors

- Problem D3.5 on Page 72 combines a central point charge with surface charges on concentric spheres and asks for fields in multiple radial regions.
- Problem 3.9 on Page 84 asks for fields inside and outside a charged sphere and for a shell charge that makes the external field zero.
- Problems 3.10 and 3.11 on Page 84 use cylindrically symmetric volume charge distributions.
- Problem 3.13 on Page 85 uses three concentric charged spherical surfaces.
- Problem 3.15 on Page 85 uses charge confined to a cylindrical annulus.
- Problem 3.17 on Page 85 asks for surfaces on which $\mathbf{E}=0$ for a radial volume charge density.

## Related Pages

- [[spherical-gaussian-surface-for-a-point-charge|Spherical Gaussian Surface for a Point Charge]]
- [[infinite-uniform-line-charge-field|Infinite Uniform Line Charge Field]]
- [[coaxial-cable-field-and-electrostatic-shielding|Coaxial Cable Field and Electrostatic Shielding]]
- [[choosing-gaussian-surfaces-by-symmetry|Choosing Gaussian Surfaces by Symmetry]]

## Concept Dependencies

- depends-on: [[spherical-gaussian-surface-for-a-point-charge|Spherical Gaussian Surface for a Point Charge]]
- depends-on: [[infinite-uniform-line-charge-field|Infinite Uniform Line Charge Field]]
