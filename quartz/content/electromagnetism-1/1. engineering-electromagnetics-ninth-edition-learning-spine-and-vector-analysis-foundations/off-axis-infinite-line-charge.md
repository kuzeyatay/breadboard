---
title: "1.44 Off-Axis Infinite Line Charge"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 50", "Page 51", "Section: 2.4.2 Field of an Off-Axis Line Charge"]
related: ["derivation-and-distance-scaling-of-the-infinite-line-field", "superposition-of-point-charge-electric-fields", "multipoles-finite-charge-distributions-and-far-field-limits"]
---

# 1.44 Off-Axis Infinite Line Charge

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 50, Page 51, Section: 2.4.2 Field of an Off-Axis Line Charge

The standard infinite-line result can be translated to a line parallel to the $z$ axis but displaced in the transverse plane. For a line through $(x_0,y_0)$ and an observation point $(x,y,z)$, the transverse displacement is $\mathbf{R}=(x-x_0)\mathbf{a}_x+(y-y_0)\mathbf{a}_y$. Its magnitude replaces the cylindrical radius measured from the original axis, and $\mathbf{a}_R=\mathbf{R}/|\mathbf{R}|$ replaces $\mathbf{a}_\rho$. Substituting these quantities into the infinite-line formula produces a Cartesian expression with denominator $R^2$. The field remains independent of $z$ because shifting either the source or observation point along an infinite uniform line does not change the geometry. This translated-vector method is reusable for multiple parallel line charges because each line can be handled with its own transverse displacement and then combined by superposition.

## Page-Grounded Details

#### Page 50

or finally,
$$
\mathbf{E}=\frac{\rho_{\mathrm{L}}}{2\pi\epsilon_{0}\rho}\mathbf{a}_{\rho}\quad{(16)}
$$
We note that the field falls off inversely with the distance to the charged line, as compared with the point charge, where the field decreased with the square of the distance. Moving 10 times as far from a point charge leads to a field only 1 percent the previous strength, but moving 10 times as far from a line charge only reduces the field to 10 percent of its former value. An analogy can be drawn with a source of illumination, for the light intensity from a point source of light also falls off inversely as the square of the distance to the source. The field of an infinitely long fluorescent tube thus decays inversely as the first power of the radial distance to the tube, and we should expect the light intensity about a finite-length tube to obey this law near the tube. As our point recedes farther and farther from a finite-length tube, however, it eventually looks like a point source, and the field obeys the inverse-square relationship.

#### 2.4.2 Field of an Off-Axis Line Charge

Before leaving this introductory look at the field of the infinite line charge, it should be re

[Truncated for analysis]

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

## Core Ideas

- Measure radial distance from the actual line, not from the coordinate-system axis.
- For a line through $(x_0,y_0)$, $R=\sqrt{(x-x_0)^2+(y-y_0)^2}$.
- The direction is the normalized transverse displacement from the line to the field point.
- The field has no $z$ component and no $z$ dependence.
- Fields from several displaced lines can be added by vector superposition.

## Source Anchors

- The worked geometry uses an infinite line parallel to $z$ at $x=6$, $y=8$.
- For that line, $R=\sqrt{(x-6)^2+(y-8)^2}$.
- The unit vector is
$$
\mathbf{a}_R=\frac{(x-6)\mathbf{a}_x+(y-8)\mathbf{a}_y}{\sqrt{(x-6)^2+(y-8)^2}}
$$
- The resulting field is
$$
\mathbf{E}=\frac{\rho_L}{2\pi\epsilon_0}\frac{(x-6)\mathbf{a}_x+(y-8)\mathbf{a}_y}{(x-6)^2+(y-8)^2}
$$
- Source figure S1.P50.F1, Figure 2.7, identifies the displaced line and general point $P(x,y,z)$.
- Drill D2.5 uses superposition for uniform line charges on the $x$ and $y$ axes.

## Related Pages

- [[derivation-and-distance-scaling-of-the-infinite-line-field|Derivation and Distance Scaling of the Infinite-Line Field]]
- [[superposition-of-point-charge-electric-fields|Superposition of Point-Charge Electric Fields]]
- [[multipoles-finite-charge-distributions-and-far-field-limits|Multipoles, Finite Charge Distributions, and Far-Field Limits]]

## Concept Dependencies

- derives-from: [[derivation-and-distance-scaling-of-the-infinite-line-field|Derivation and Distance Scaling of the Infinite-Line Field]]
- applies-to: [[multipoles-finite-charge-distributions-and-far-field-limits|Multipoles, Finite Charge Distributions, and Far-Field Limits]]
