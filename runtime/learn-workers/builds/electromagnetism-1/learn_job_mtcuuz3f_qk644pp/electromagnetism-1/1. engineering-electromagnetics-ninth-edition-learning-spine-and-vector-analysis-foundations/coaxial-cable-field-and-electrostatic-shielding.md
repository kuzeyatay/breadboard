---
title: "1.59 Coaxial Cable Field and Electrostatic Shielding"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 70", "Page 71", "Page 72", "Figure 3.5"]
related: ["infinite-uniform-line-charge-field", "choosing-gaussian-surfaces-by-symmetry", "fields-from-layered-charge-distributions", "gauss-law-in-integral-form", "coaxial-cable-charge-and-field-calculation"]
---

# 1.59 Coaxial Cable Field and Electrostatic Shielding

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 70, Page 71, Page 72, Figure 3.5

A coaxial cable consists of two coaxial cylindrical conductors with inner radius $a$ and outer radius $b$. If the outer surface of the inner conductor carries uniform surface charge density $\rho_S$, cylindrical symmetry requires $\mathbf{D}=D_\rho(\rho)\mathbf{a}_\rho$. For a gaussian cylinder with $a<\rho<b$, the enclosed charge over length $L$ is $Q=2\pi aL\rho_S$. Gauss's law gives $D_\rho(2\pi\rho L)=Q$, so $\mathbf{D}=a\rho_S\mathbf{a}_\rho/\rho$. Defining line charge density as $\rho_L=2\pi a\rho_S$ gives the equivalent form $\mathbf{D}=\rho_L\mathbf{a}_\rho/(2\pi\rho)$. Equal and opposite total charge appears on the inner surface of the outer conductor, which leads to $\rho_{S,\mathrm{outer}}=-(a/b)\rho_{S,\mathrm{inner}}$. A gaussian surface outside the outer conductor encloses zero net charge, so the external field is zero. The field is also zero inside the inner conductor. The ideal result applies approximately to a finite open cable when its length is much greater than its outer radius and end effects are negligible.

## Page-Grounded Details

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
$$
\rho_{S,\

[Truncated for analysis]

#### Page 72

An identical result would be obtained for $\rho<a$. Thus the coaxial cable or capacitor has no external field (we have proved that the outer conductor is a "shield"), and there is no field within the center conductor.

Our result is also useful for a finite length of coaxial cable, open at both ends, provided the length L is many times greater than the radius b so that the nonsymmetrical conditions at the two ends do not appreciably affect the solution. Such a device is also termed a coaxial capacitor. Both the coaxial cable and the coaxial capacitor will appear frequently in the work that follows.

#### EXAMPLE 3.2

Let us select a 50-cm length of coaxial cable having an inner radius of 1 mm and an outer radius of 4 mm. The space between conductors is assumed to be filled with air. The total charge on the inner conductor is 30 nC. We wish to know the charge density on each conductor, and the E and D fields.

Solution. We begin by finding the surface charge density on the inner cylinder
$$
 \rho_{S,\text{innercyl}}=\frac{Q_{\text{innercyl}}}{2\pi aL}=\frac{30\times 10^{-9}}{2\pi(10^{-3})(0.5)}=9.55\,\mu\text{C/m}^{2} $$
The negative charge density on the inner surface of the ou

[Truncated for analysis]

## Core Ideas

- Between conductors, $\mathbf{D}=a\rho_S\mathbf{a}_\rho/\rho$.
- The inner conductor line charge density is $\rho_L=2\pi a\rho_S$.
- The field between conductors matches the infinite line-charge form.
- The outer conductor's inner surface carries equal and opposite total charge.
- Surface densities satisfy $\rho_{S,\mathrm{outer}}=-(a/b)\rho_{S,\mathrm{inner}}$.
- The field is zero for $\rho<a$ and for $\rho>b$ in the ideal model.
- Zero external field demonstrates electrostatic shielding by the outer conductor.
- Finite-length results require negligible end effects.

## Source Anchors

- Pages 70 and 71 derive $Q=2\pi aL\rho_S$ and $\mathbf{D}=a\rho_S\mathbf{a}_\rho/\rho$ for $a<\rho<b$.
- Page 71 rewrites the field using $\rho_L=2\pi a\rho_S$.
- Page 71 derives $\rho_{S,\mathrm{outer}}=-(a/b)\rho_{S,\mathrm{inner}}$.
- Pages 71 and 72 show that the field is zero outside the outer conductor and inside the center conductor.
- S1.P71.F1 identifies the coaxial geometry and the field $D_\rho=a\rho_S/\rho$.
- Page 72 states that the finite-length approximation is valid when $L$ is many times greater than $b$.

## Related Pages

- [[infinite-uniform-line-charge-field|Infinite Uniform Line Charge Field]]
- [[choosing-gaussian-surfaces-by-symmetry|Choosing Gaussian Surfaces by Symmetry]]
- [[fields-from-layered-charge-distributions|Fields from Layered Charge Distributions]]
- [[gauss-law-in-integral-form|Gauss's Law in Integral Form]]
- [[coaxial-cable-charge-and-field-calculation|Coaxial Cable Charge and Field Calculation]]

## Concept Dependencies

- derives-from: [[infinite-uniform-line-charge-field|Infinite Uniform Line Charge Field]]
- applies-to: [[coaxial-cable-charge-and-field-calculation|Coaxial Cable Charge and Field Calculation]]
- related: [[fields-from-layered-charge-distributions|Fields from Layered Charge Distributions]]
