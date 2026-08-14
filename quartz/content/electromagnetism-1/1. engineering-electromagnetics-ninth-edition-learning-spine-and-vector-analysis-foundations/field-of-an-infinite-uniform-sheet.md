---
title: "1.45 Field of an Infinite Uniform Sheet"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 51", "Page 52", "Page 53", "Section: 2.5 Field of a Sheet of Charge", "Section: 2.5.1 Symmetry", "Section: 2.5.2 The Sheet Charge as an Ensemble of Line Charges"]
related: ["symmetry-of-an-infinite-uniform-line-charge", "derivation-and-distance-scaling-of-the-infinite-line-field", "parallel-plate-capacitor-field", "charge-distribution-dimensionality"]
---

# 1.45 Field of an Infinite Uniform Sheet

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 51, Page 52, Page 53, Section: 2.5 Field of a Sheet of Charge, Section: 2.5.1 Symmetry, Section: 2.5.2 The Sheet Charge as an Ensemble of Line Charges

An infinite uniform sheet in the $yz$ plane is unchanged by translations along $y$ or $z$, so its field cannot depend on either coordinate. Symmetrically located source elements cancel all tangential components, leaving only a component normal to the sheet. The sheet can be divided into differential strips parallel to the $z$ axis. Each strip behaves as an infinite line charge with $d\rho_L=\rho_Sdy'$. The normal component of each strip field is integrated over $-\infty<y'<\infty$. The resulting field has constant magnitude $\rho_S/(2\epsilon_0)$ and points away from a positively charged sheet on either side. A normal unit vector directed outward avoids separate sign formulas. Unlike point and line fields, the ideal infinite-sheet field does not decrease with distance because progressively more distant portions of the infinite sheet continue contributing.

## Page-Grounded Details

#### Page 51

$\rho$ is replaced in (16) by the radial distance between the line charge and point, $P,R=\sqrt{(x-6)^{2}+(y-8)^{2}}$, and let $a_{\rho}$ be $a_{R}$. Thus,
$$
E=\frac{\rho_{L}}{2\pi\epsilon_{0}\sqrt{(x-6)^{2}+(y-8)^{2}}}a_{R}
$$
where
$$
a_{R}=\frac{R}{|R|}=\frac{(x-6)a_{x}+(y-8)a_{y}}{\sqrt{(x-6)^{2}+(y-8)^{2}}}
$$
Therefore,
$$
E=\frac{\rho_{L}}{2\pi\epsilon_{0}}\frac{(x-6)a_{x}+(y-8)a_{y}}{(x-6)^{2}+(y-8)^{2}}
$$
We again note that the field is not a function of $z$.

In Section 2.6, we describe how fields may be sketched, and the field of the line charge is one example.

D2.5. Infinite uniform line charges of 5 nC/m lie along the (positive and negative) x and y axes in free space. Find E at: (a) $P_{A}(0,0,4)$; (b) $P_{B}(0,3,4)$.

Ans. (a) $45a_{z}$ V/m; (b) $10.8a_{y}+36.9a_{z}$ V/m

#### 2.5 FIELD OF A SHEET OF CHARGE

Another basic charge configuration is the infinite sheet of charge having a uniform density of $\rho_{S}$ C/$m^{2}$. Such a charge distribution may often be used to approximate that found on the conductors of a strip transmission line or a parallel-plate capacitor. As will be seen in Chapter 5, static charge resides on conductor sur

[Truncated for analysis]

#### Page 52

Figure 2.8 An infinite sheet of charge in the $yz$ plane, a general point $P$ on the $x$ axis, and the differential-width line charge used as the element in determining the field at $P$ by $d\mathbf{E}=\rho_{S}dy^{\prime}\mathbf{a}_{R}/(2\pi\epsilon_{0}R)$.

#### 2.5.2 The Sheet Charge as an Ensemble of Line Charges

The field of the infinite line charge (16) is implemented here by dividing the infinite sheet into differential-width strips. One such strip is shown in Figure 2.8. The line charge density, or charge per unit length, is $\rho_{L}=\rho_{S}dy^{\prime}$, and the distance from this line charge to our general point $P$ on the $x$ axis is $R=\sqrt{x^{2}+y^{2}}$. The contribution to $E_{x}$ at $P$ from this differential-width strip is then
$$
dE_{x}=\frac{\rho_{S}dy^{\prime}}{2\pi\epsilon_{0}\sqrt{x^{2}+y^{\prime 2}}}\cos\theta=\frac{\rho_{S}}{2\pi\epsilon_{0}}\frac{xdy^{\prime}}{x^{2}+y^{\prime 2}}
$$
Adding the effects of all the strips,
$$
E_{x}=\frac{\rho_{S}}{2\epsilon_{0}}\int_{-\infty}^{\infty}\frac{xdy^{\prime}}{x^{2}+y^{\prime 2}}=\frac{\rho_{S}}{2\pi\epsilon_{0}}\tan^{-1}\frac{y^{\prime}}{x}|_{-\infty}^{\infty}=\frac{\rho_{S}}{2\pi\epsilon_{

[Truncated for analysis]

#### Page 53

on a square foot a few inches below the ceiling. If you desire greater illumination on this subject, it will do you no good to hold the book closer to such a light source.

#### 2.5.3 Capacitor Model

If a second infinite sheet of charge, having a negative charge density $-\rho_{S}$, is located in the plane $x = a$, the total field may be found by adding the contribution of each sheet. In the region $x > a$
$$
 E_{+}=\frac{\rho_{S}}{2\,\epsilon_{0}}a_{x} \quad E_{-}=-\frac{\rho_{S}}{2\,\epsilon_{0}}a_{x} \quad E=E_{+}+E_{-}=0
$$
and for $x < 0$
$$
 E_{+}=-\frac{\rho_{S}}{2\,\epsilon_{0}}a_{x} \quad E_{-}=\frac{\rho_{S}}{2\,\epsilon_{0}}a_{x} \quad E=E_{+}+E_{-}=0
$$
and when $0 < x < a$
$$
 E_{+}=\frac{\rho_{S}}{2\,\epsilon_{0}}a_{x} \quad E_{-}=\frac{\rho_{S}}{2\,\epsilon_{0}}a_{x}
$$
and
$$
 E=E_{+}+E_{-}=\frac{\rho_{S}}{\epsilon_{0}}a_{x}
$$
This is an important practical answer, for it is the field between the parallel plates of an air capacitor, provided the linear dimensions of the plates are very much greater than their separation and provided also that we are considering a point well removed from the edges. The field outside the capacitor, while not zero, a

[Truncated for analysis]

## Core Ideas

- Translational symmetry removes dependence on coordinates parallel to the sheet.
- Tangential field components cancel by symmetry.
- Only the normal component remains.
- A differential strip has line density $d\rho_L=\rho_Sdy'$.
- The ideal infinite-sheet field is independent of distance.
- Its direction is away from positive surface charge.

## Source Anchors

- Source figure S1.P51.F1, Figure 2.8, shows an infinite sheet in the $yz$ plane and a point $P$ on the $x$ axis.
- For a strip
$$
dE_x=\frac{\rho_S}{2\pi\epsilon_0}\frac{x\,dy'}{x^2+y'^2}.
$$
- The strips are integrated over $-\infty<y'<\infty$.
- Equation (17):
$$
\mathbf{E}=\frac{\rho_S}{2\epsilon_0}\mathbf{a}_N.$$
- On opposite sides of the sheet, the field has equal magnitude and opposite normal direction.
- The text compares the constant field with illumination from a uniformly luminous infinite ceiling.

## Related Pages

- [[symmetry-of-an-infinite-uniform-line-charge|Symmetry of an Infinite Uniform Line Charge]]
- [[derivation-and-distance-scaling-of-the-infinite-line-field|Derivation and Distance Scaling of the Infinite-Line Field]]
- [[parallel-plate-capacitor-field|Parallel-Plate Capacitor Field]]
- [[charge-distribution-dimensionality|Charge-Distribution Dimensionality]]

## Concept Dependencies

- derives-from: [[derivation-and-distance-scaling-of-the-infinite-line-field|Derivation and Distance Scaling of the Infinite-Line Field]]
- enables: [[parallel-plate-capacitor-field|Parallel-Plate Capacitor Field]]
