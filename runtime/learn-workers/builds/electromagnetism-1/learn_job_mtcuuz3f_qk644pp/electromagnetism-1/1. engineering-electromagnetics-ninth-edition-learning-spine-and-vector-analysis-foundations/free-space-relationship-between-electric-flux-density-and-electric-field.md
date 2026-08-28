---
title: "1.52 Free-Space Relationship Between Electric Flux Density and Electric Field"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 63", "Page 64", "Section: 3.1.2 Electric Flux Density"]
related: ["electric-flux-density-from-charge", "electric-field-integral-for-a-volume-charge-distribution", "charge-distribution-dimensionality", "gausss-law-for-closed-surfaces"]
---

# 1.52 Free-Space Relationship Between Electric Flux Density and Electric Field

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 63, Page 64, Section: 3.1.2 Electric Flux Density

For a point charge in free space, the electric field intensity and electric flux density have identical direction and inverse-square geometry, but their magnitudes differ by the free-space permittivity $\epsilon_0$. Comparing their point-charge formulas gives $\mathbf{D}=\epsilon_0\mathbf{E}$. Superposition extends this relation to any free-space charge configuration. The volume integral for $\mathbf{D}$ has the same source density, separation, and direction factors as the corresponding integral for $\mathbf{E}$, but it does not contain $\epsilon_0$ in the denominator. This makes many $\mathbf{D}$ expressions algebraically simpler. The source cautions that the free-space relation does not directly apply inside a general dielectric, even though the point-charge flux-density expression remains tied to source charge. Later material must therefore supply a more general medium-dependent relation between $\mathbf{D}$ and $\mathbf{E}$.

## Page-Grounded Details

#### Page 63

This result should be compared with Section 2.2, Eq. (9), the radial electric field intensity of a point charge in free space,
$$
E = \frac{Q}{4\pi\epsilon_{0} r^{2} a_{r}}
$$
In free space, therefore,
$$
D = \epsilon_{0} E \quad ( \text{free space only} )
$$
(2)

Although (2) is applicable only to a vacuum, it is not restricted solely to the field of a point charge. For a general volume charge distribution in free space, the discussion in Section 2.3.2 resulted in
$$
E = \int_{\rm vol} \frac{\rho_{v} dv}{4\pi \epsilon_{0} R^{2} a_{R}} \quad ( \text{free space only} )
$$
(3)

This relationship was developed from the field of a single point charge. In a similar manner, (1) leads to
$$
D = \int_{\rm vol} \frac{\rho_{v} dv}{4\pi R^{2} a_{R}}
$$
(4)

and (2) is therefore true for any free-space charge configuration; we will consider (2) as defining D in free space.

As a preparation for the study of dielectrics later, it might be well to point out now that, for a point charge embedded in an infinite ideal dielectric medium, Fara-day's results show that (1) is still applicable, and thus so is (4). Equation (3) is not applicable, however, and so the relationship between D and E w

[Truncated for analysis]

#### Page 64

D3.2. Calculate D in rectangular coordinates at point P(2,-3,6) produced by: (a) a point charge $Q_{A}$ = 55 mC at Q(-2,3,-6); (b) a uniform line charge $\rho_{LB}$ = 20 mC/m on the x axis; (c) a uniform surface charge density $\rho_{SC}$ = 120 $\mu C/m^{2}$ on the plane z = -5 m.

Ans. (a) $6.38a_{x} - 9.57a_{y} + 19.14a_{z} \ \mu C/m^{2}$; (b) $-212a_{y} + 424a_{z} \ \mu C/m^{2}$; (c) $60a_{z} \ \mu C/m^{2}$

#### 3.2 GAUSS'S LAW

The results of Faraday's experiments with the concentric spheres could be summed up as an experimental law by stating that the electric flux passing through any imaginary spherical surface lying between the two conducting spheres is equal to the charge enclosed within that imaginary surface. This enclosed charge is distributed on the surface of the inner sphere, or it might be concentrated as a point charge at the center of the imaginary sphere. However, because one coulomb of electric flux is produced by one coulomb of charge, the inner conductor might just as well have been a cube or a brass door key and the total induced charge on the outer sphere would still be the same. Certainly the flux density would change from its previous symmetr

[Truncated for analysis]

## Core Ideas

- In free space, $\mathbf{D}$ and $\mathbf{E}$ are parallel.
- Their free-space relation is $\mathbf{D}=\epsilon_0\mathbf{E}$.
- The relation applies to any free-space charge configuration by superposition.
- The $\mathbf{D}$ source integral omits the factor $\epsilon_0$.
- The meanings of $\mathbf{D}$ and $\mathbf{E}$ remain distinct despite proportionality.
- A more general constitutive relation is required in dielectric media.

## Source Anchors

- The point-charge field is
$$
\mathbf{E}=\frac{Q}{4\pi\epsilon_0r^2}\mathbf{a}_r
$$
- Equation (2):
$$
\mathbf{D}=\epsilon_0\mathbf{E}\qquad\text{(free space only)}
$$
- Equation (3) gives the free-space volume integral for $\mathbf{E}$.
- Equation (4):
$$
\mathbf{D}=\int_{\mathrm{vol}}\frac{\rho_vdv}{4\pi R^2}\mathbf{a}_R
$$
- The source states that Equation (2) is valid for any free-space charge configuration.
- Drill D3.2 asks for $\mathbf{D}$ at one point due to a point charge, a line charge, and a charged plane.

## Related Pages

- [[electric-flux-density-from-charge|Electric Flux Density from Charge]]
- [[electric-field-integral-for-a-volume-charge-distribution|Electric Field Integral for a Volume Charge Distribution]]
- [[charge-distribution-dimensionality|Charge-Distribution Dimensionality]]
- [[gausss-law-for-closed-surfaces|Gauss's Law for Closed Surfaces]]

## Concept Dependencies

- depends-on: [[electric-flux-density-from-charge|Electric Flux Density from Charge]]
- derives-from: [[electric-field-integral-for-a-volume-charge-distribution|Electric Field Integral for a Volume Charge Distribution]]
