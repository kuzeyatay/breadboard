---
title: "1.57 Choosing Gaussian Surfaces by Symmetry"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 68", "Page 69", "Page 70", "Page 71", "Page 72"]
related: ["spherical-gaussian-surface-for-a-point-charge", "infinite-uniform-line-charge-field", "coaxial-cable-field-and-electrostatic-shielding", "fields-from-layered-charge-distributions"]
---

# 1.57 Choosing Gaussian Surfaces by Symmetry

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 68, Page 69, Page 70, Page 71, Page 72

Gauss's law becomes a direct field-solving method only when symmetry allows the flux integral to simplify. The source gives two practical requirements. First, the field must be either normal or tangential to each relevant portion of the closed surface, making the dot product equal to $D\,dS$ or zero. Second, the field magnitude must be constant over every surface portion through which nonzero flux passes. Under these conditions, the unknown magnitude can be moved outside the integral and the remaining integral is simply an area. Before selecting a surface, one must determine which coordinates the field depends on and which vector components can exist. Spherical symmetry suggests a centered sphere, cylindrical symmetry suggests a coaxial cylinder, and planar symmetry suggests a pillbox-like surface. Symmetry is not merely a convenience in these derivations. Without a justified symmetry argument, Gauss's law still gives net flux but usually cannot isolate the field magnitude. The method is particularly valuable where direct use of Coulomb's law would require difficult integration.

## Page-Grounded Details

#### Page 68

#### 3.3 APPLICATION OF GAUSS'S LAW: SOME SYMMETRICAL CHARGE DISTRIBUTIONS

We now consider how we may use Gauss's law,
$$
Q=\oint_{S}\mathbf{D}_{S}\cdot d\mathbf{S}
$$
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

#### Page 71

Figure 3.5 The two coaxial cylindrical conductors forming a coaxial cable provide an electric flux density within the cylinders, given by $D_{\rho}=a\rho_{S}/\rho$.

The total charge on a length $L$ of the inner conductor is
$$
Q=\int_{z=0}^{L}\int_{\phi=0}^{2\pi}\rho_{S}a\,d\phi\,dz=2\pi aL\rho_{S}
$$
from which we have
$$
D_{S}=\frac{a\rho_{S}}{\rho}\qquad\mathbf{D}=\frac{a\rho_{S}}{\rho}\mathbf{a}_{\rho}\qquad(a<\rho<b)
$$
This result might be expressed in terms of charge per unit length because the inner conductor has $2\pi\,a\rho_{S}$ coulombs on a meter length, and hence, letting $\rho_{L}=2\pi\,a\rho_{S}$,
$$
\mathbf{D}=\frac{\rho_{L}}{2\pi\rho}\mathbf{a}_{\rho}
$$
and the solution has a form identical with that of the infinite line charge.

Because every line of electric flux starting from the charge on the inner cylinder must terminate on a negative charge on the inner surface of the outer cylinder, the total charge on that surface must be
$$
Q_{\mathrm{outer\ cyl}}=-2\pi aL\rho_{S,\mathrm{inner\ cyl}}
$$
and the surface charge on the outer cylinder is found as
$$
2\pi bL\rho_{S,\mathrm{outer\ cyl}}=-2\pi aL\rho_{S,\mathrm{inner\ cyl}}
$$
or
$$ \rho_{S,\

[Truncated for analysis]

## Core Ideas

- Determine the allowed field components before choosing a gaussian surface.
- Determine which coordinates can affect the field magnitude.
- Choose surface portions where the field is normal or tangential.
- Require constant field magnitude wherever the flux contribution is nonzero.
- Replace $\mathbf{D}\cdot d\mathbf{S}$ by $D\,dS$ on normal portions.
- Set the flux contribution to zero on tangential portions.
- Equate field magnitude times effective area to enclosed charge.
- Do not infer a detailed field from Gauss's law without adequate symmetry.

## Source Anchors

- Page 68 lists the two conditions needed for a simple gaussian-surface solution.
- Page 68 explains that $D_S$ can be removed from the integral when it is constant over the contributing surface.
- Page 69 requires identifying the coordinates on which $\mathbf{D}$ depends and the components that are present.
- Page 69 states that application of Gauss's law depends on symmetry rather than merely being simplified by it.
- Pages 69 through 72 apply the method to line charge and coaxial conductor geometries.

## Related Pages

- [[spherical-gaussian-surface-for-a-point-charge|Spherical Gaussian Surface for a Point Charge]]
- [[infinite-uniform-line-charge-field|Infinite Uniform Line Charge Field]]
- [[coaxial-cable-field-and-electrostatic-shielding|Coaxial Cable Field and Electrostatic Shielding]]
- [[fields-from-layered-charge-distributions|Fields from Layered Charge Distributions]]

## Concept Dependencies

- enables: [[infinite-uniform-line-charge-field|Infinite Uniform Line Charge Field]]
- enables: [[coaxial-cable-field-and-electrostatic-shielding|Coaxial Cable Field and Electrostatic Shielding]]
- enables: [[fields-from-layered-charge-distributions|Fields from Layered Charge Distributions]]
