---
title: "1.116 Point Form of Ampere's Law"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 215", "Page 216", "Equations 7.27-7.29", "Section 7.4: Stokes' Theorem"]
related: ["ampere-circuital-law-enclosed-current", "curl-circulation-per-unit-area", "coordinate-formulas-for-curl", "stokes-theorem-integral-point-bridge"]
---

# 1.116 Point Form of Ampere's Law

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 215, Page 216, Equations 7.27-7.29, Section 7.4: Stokes' Theorem

Combining the three Cartesian curl components obtained from differential Amperian loops produces the magnetostatic point equation
$$
\nabla\times\mathbf{H}=\mathbf{J}
$$
This equation states that the curl of magnetic field intensity at a point equals the volume current density at that point. It is the differential, or per-unit-area, form of Ampere's circuital law and is identified as the second of Maxwell's four equations under non-time-varying conditions. The text also records the electrostatic counterpart
$$
\nabla\times\mathbf{E}=0
$$
which follows from $\oint\mathbf{E}\cdot d\mathbf{L}=0$. The contrast is physically important: electrostatic electric fields have zero circulation around every closed path, while magnetostatic magnetic fields can have nonzero circulation when current pierces the path. The current density can therefore be recovered from a known magnetic field by evaluating its curl in the appropriate coordinate system.

## Page-Grounded Details

#### Page 215

Solution. We evaluate the line integral of H along the four segments, beginning at the top:
$$
\begin{align*}\oint\mathbf{H}\cdot d\mathbf{L}&=0.2\left(z_{1}+\frac{1}{2}d\right)^{2}d+0-0.2\left(z_{1}-\frac{1}{2}d\right)^{2}d+0\\ &=0.4z_{1}d^{2}\end{align*}
$$
In the limit as the area approaches zero, we find
$$
(\nabla\times\mathbf{H})_{y}=\lim_{d\to 0}\frac{\oint\mathbf{H}\cdot d\mathbf{L}}{d^{2}}=\lim_{d\to 0}\frac{0.4z_{1}d^{2}}{d^{2}}=0.4z_{1}
$$
The other components are zero, so $\nabla\times\mathbf{H}=0.4z_{1}\mathbf{a}_{y}$.

To evaluate the curl without trying to illustrate the definition or the evaluation of a line integral, we simply take the partial derivative indicated by (23):
$$
\nabla\times\mathbf{H}=\begin{vmatrix}\mathbf{a}_{x}&\mathbf{a}_{y}&\mathbf{a}_{z}\\\frac{\partial}{\partial x}&\frac{\partial}{\partial y}&\frac{\partial}{\partial z}\\0.2z^{2}&0&0\end{vmatrix}=\frac{\partial}{\partial z}(0.2z^{2})\mathbf{a}_{y}=0.4z\mathbf{a}_{y}
$$
which checks with the preceding result when $z=z_{1}$.

Returning now to complete our original examination of the application of Ampère's circuital law to a differential-sized path, we may combine (18)-(20), (22), and (

[Truncated for analysis]

#### Page 216

D7.4. (a) Evaluate the closed line integral of H about the rectangular path $P_{1}(2, 3, 4)$ to $P_{2}(4, 3, 4)$ to $P_{3}(4, 3, 1)$ to $P_{4}(2, 3, 1)$ to $P_{1}$, given $H=3z\mathbf{a}_{x}-2x^{3}\mathbf{a}_{z}$ A/m. (b) Determine the quotient of the closed line integral and the area enclosed by the path as an approximation to $(\nabla\times H)_{y}$. (c) Determine $(\nabla\times H)_{y}$ at the center of the area.

Answer. (a) 354 A; (b) 59 $A/m^{2}$; (c) 57 $A/m^{2}$

D7.5. Calculate the value of the vector current density: (a) in rectangular coordinates at $P_{A}(2, 3, 4)$ if $H=x^{2}z\mathbf{a}_{y}-y^{2}x\mathbf{a}_{z}$; (b) in cylindrical coordinates at $P_{B}(1.5, 90^{\circ}, 0.5)$ if $H=\frac{2}{\rho}(\cos0.2\phi)\mathbf{a}_{\rho}$; (c) in spherical coordinates at $P_{C}(2, 30^{\circ}, 20^{\circ})$ if $H=\frac{1}{\sin\theta}\mathbf{a}_{\theta}$.

Answer. (a) $-16\mathbf{a}_{x}+9\mathbf{a}_{y}+16\mathbf{a}_{z}$ A/m^2; (b) 0.055$\mathbf{a}_{z}$ A/m^2; (c) $\mathbf{a}_{\phi}$ A/m^2

#### 7.4 STOKES' THEOREM

Although Section 7.3 was devoted primarily to a discussion of the curl operation, the contribution to the subject of magnetic fields sh

[Truncated for analysis]

## Core Ideas

- The point form of Ampere's law is $\nabla\times\mathbf{H}=\mathbf{J}$.
- It relates a local field derivative to local current density.
- It is the differential counterpart of $\oint\mathbf{H}\cdot d\mathbf{L}=I_{\mathrm{encl}}$.
- The equation is a magnetostatic Maxwell equation.
- Electrostatics instead gives $\nabla\times\mathbf{E}=0$.
- A known magnetic field can be differentiated to determine $\mathbf{J}$.

## Source Anchors

- Page 215 combines the three Cartesian curl components into $\nabla\times\mathbf{H}=\mathbf{J}$.
- Page 215 labels this relationship as the point form of Ampere's circuital law.
- Page 215 identifies it as the second Maxwell equation for non-time-varying conditions.
- Page 215 gives $\nabla\times\mathbf{E}=0$ as the point form of zero electrostatic circulation.
- Page 216 states that the point form applies on a per-unit-area basis.

## Related Pages

- [[ampere-circuital-law-enclosed-current|Ampere's Circuital Law and Enclosed Current]]
- [[curl-circulation-per-unit-area|Curl as Circulation per Unit Area]]
- [[coordinate-formulas-for-curl|Coordinate Formulas for Curl]]
- [[stokes-theorem-integral-point-bridge|Stokes' Theorem as the Integral-to-Point Bridge]]

## Concept Dependencies

- derives-from: [[curl-circulation-per-unit-area|Curl as Circulation per Unit Area]]
- related: [[ampere-circuital-law-enclosed-current|Ampere's Circuital Law and Enclosed Current]]
