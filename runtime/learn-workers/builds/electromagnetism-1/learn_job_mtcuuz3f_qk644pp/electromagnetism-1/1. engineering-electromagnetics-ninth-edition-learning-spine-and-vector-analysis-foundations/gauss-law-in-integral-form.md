---
title: "1.55 Gauss's Law in Integral Form"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 65", "Page 66", "Page 67", "Page 83", "Page 84"]
related: ["electric-flux-through-an-oriented-surface", "choosing-gaussian-surfaces-by-symmetry", "maxwells-first-equation", "divergence-theorem"]
---

# 1.55 Gauss's Law in Integral Form

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 65, Page 66, Page 67, Page 83, Page 84

Gauss's law states that the total outward electric flux through any closed surface equals the total charge enclosed by that surface. In electric-flux-density notation, the law is $\oint_S\mathbf{D}\cdot d\mathbf{S}=Q_{\mathrm{enc}}$. The enclosed charge can arise from point charges, line charge, surface charge, volume charge, or a combination of these. The corresponding calculations are $Q=\sum_n Q_n$, $Q=\int\rho_L\,dL$, $Q=\int_S\rho_S\,dS$, and $Q=\int_V\rho_v\,dv$. The volume-density representation is commonly used as a general expression, giving $\oint_S\mathbf{D}\cdot d\mathbf{S}=\int_V\rho_v\,dv$. Only charge inside the chosen closed surface enters the right-hand side directly. The law determines total flux without requiring the detailed field distribution, but obtaining the field itself from the law generally requires sufficient symmetry. Practice problems emphasize first identifying the enclosed region and then integrating or summing only the charge lying within it.

## Page-Grounded Details

#### Page 65

Figure 3.2 The electric flux density $\mathbf{D}_{S}$ at $P$ arising from charge $Q$. The total flux passing through $\Delta\mathbf{S}$ is $\mathbf{D}_{S}\cdot\Delta\mathbf{S}$.

vector quantity. The only unique direction that may be associated with $\Delta\mathbf{S}$ is the direc-tion of the normal to that plane which is tangent to the surface at the point in question. There are, of course, two such normals, and the ambiguity is removed by specifying the outward normal whenever the surface is closed; "outward" has a specific meaning.

At any point $P$, consider an incremental element of surface $\Delta S$ and let $\mathbf{D}_{S}$ make an angle $\theta$ with $\Delta\mathbf{S}$, as shown in Figure 3.2. The flux crossing $\Delta S$ is then the product of the normal component of $\mathbf{D}_{S}$ and $\Delta\mathbf{S}$,
$$
\Delta\Psi=\text{flux crossing }\Delta S=D_{S,\text{norm}}\Delta S=D_{S}\cos\theta\,\Delta S=\mathbf{D}_{S}\cdot\Delta\mathbf{S}
$$
where we are able to apply the definition of the dot product developed in Chapter 1.

The total flux passing through the closed surface is obtained by adding the dif-ferential contributions crossing each sur

[Truncated for analysis]

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
 \int_{0}^{2\pi}\frac{Q}{4\pi}(-\cos\theta)_{0}^{\pi}\,d\phi=\int_{0}^{2\pi}\frac{Q}{2\pi}d\phi=Q $$
and we obtain a result showing that $Q$ coulombs of electric flux are crossing the surface, as we should since the enclosed charge is $Q$ coulombs.

D3.3. Given the electric flux density, $\mathbf{D}=0.3r^{2}\mathbf{a}_{r}$, nC/m^2 in free space: ($a$) find $\mathbf{E}$ at point $P(r=2,\theta=25^{\circ},\phi=90^{\circ})$; ($b$) find the total charge within the sphere $r=3$; ($c$) find the total electric flux leaving the sphere $r=4$.

Ans. ($a$) 135.5$\mathbf{a}_{r}$ V/m; ($b$) 305 nC; ($c$) 965 nC

D3.4. Calculate the total electric flux leaving the cubical surface formed by the six planes $x,y,z=\pm 5$ if the charge distribution is: ($ a

[Truncated for analysis]

#### Page 83

#### REFERENCES

1. Kraus, J. D., and D. A. Fleisch. Electromagnetics. 5th ed. New York: McGraw-Hill, 1999. The static electric field in free space is introduced in Chapter 2.

2. Plonsey, R., and R. E. Collin. Principles and Applications of Electromagnetic Fields. New York: McGraw-Hill, 1961. The level of this text is somewhat higher than the one we are reading now, but it is an excellent text to read next. Gauss's law appears in the second chapter.

3. Plonus, M. A. Applied Electromagnetics. New York: McGraw-Hill, 1978. This book contains rather detailed descriptions of many practical devices that illustrate electromagnetic applications. For example, see the discussion of xerography on pp. 95-98 as an electrostatics application.

4. Skilling, H. H. Fundamentals of Electric Waves. 2d ed. New York: John Wiley & Sons, 1948. The operations of vector calculus are well illustrated. Divergence is discussed on pp. 22 and 38. Chapter 1 is interesting reading.

5. Thomas, G. B., Jr., and R. L. Finney. (See Suggested References for Chapter 1.) The divergence theorem is developed and illustrated from several different points of view on pp. 976-980.

#### CHAPTER 3 PROBLEMS

3.1

Suppose that

[Truncated for analysis]

## Core Ideas

- Gauss's law is $\oint_S\mathbf{D}\cdot d\mathbf{S}=Q_{\mathrm{enc}}$.
- The surface $S$ must be closed.
- Point charges contribute through $Q=\sum_n Q_n$.
- Line charge contributes through $Q=\int\rho_L\,dL$.
- Surface charge contributes through $Q=\int_S\rho_S\,dS$.
- Volume charge contributes through $Q=\int_V\rho_v\,dv$.
- The total outward flux is measured in coulombs when $\mathbf{D}$ is in $\mathrm{C/m^2}$.

## Source Anchors

- Page 65 states $\Psi=\oint_S\mathbf{D}_S\cdot d\mathbf{S}=Q$.
- Pages 65 and 66 list enclosed-charge formulas for point, line, surface, and volume distributions.
- Page 66 writes $\oint_S\mathbf{D}_S\cdot d\mathbf{S}=\int_{\mathrm{vol}}\rho_v\,dv$.
- Problem D3.4 on Page 67 asks for flux leaving a cube for point, line, and surface charge distributions.
- Problems 3.2 and 3.4 on Pages 83 and 84 ask for charge enclosed by a cube and sphere from specified electric fields.

## Related Pages

- [[electric-flux-through-an-oriented-surface|Electric Flux Through an Oriented Surface]]
- [[choosing-gaussian-surfaces-by-symmetry|Choosing Gaussian Surfaces by Symmetry]]
- [[maxwells-first-equation|Maxwell's First Equation]]
- [[divergence-theorem|Divergence Theorem]]

## Concept Dependencies

- applies-to: [[choosing-gaussian-surfaces-by-symmetry|Choosing Gaussian Surfaces by Symmetry]]
- related: [[maxwells-first-equation|Maxwell's First Equation]]
- derives-from: [[divergence-theorem|Divergence Theorem]]
