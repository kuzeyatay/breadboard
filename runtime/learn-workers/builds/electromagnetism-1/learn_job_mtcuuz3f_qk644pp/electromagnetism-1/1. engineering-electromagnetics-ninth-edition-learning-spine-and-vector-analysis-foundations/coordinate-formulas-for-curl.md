---
title: "1.113 Coordinate Formulas for Curl"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 211", "Page 212", "Page 216", "Equations 7.22-7.26", "Exercises D7.4-D7.5"]
related: ["curl-circulation-per-unit-area", "physical-meaning-of-curl", "point-form-of-amperes-law"]
---

# 1.113 Coordinate Formulas for Curl

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 211, Page 212, Page 216, Equations 7.22-7.26, Exercises D7.4-D7.5

The geometric definition of curl leads to coordinate-specific differentiation formulas. In rectangular coordinates,
$$
\nabla\times\mathbf{H}=\left(\frac{\partial H_z}{\partial y}-\frac{\partial H_y}{\partial z}\right)\mathbf{a}_x+\left(\frac{\partial H_x}{\partial z}-\frac{\partial H_z}{\partial x}\right)\mathbf{a}_y+\left(\frac{\partial H_y}{\partial x}-\frac{\partial H_x}{\partial y}\right)\mathbf{a}_z
$$
The same expression can be stored mnemonically as a determinant involving the unit vectors, derivative operators, and field components. The compact notation is $\operatorname{curl}\mathbf{H}=\nabla\times\mathbf{H}$. Cylindrical and spherical forms contain scale factors arising from their curvilinear coordinates. For example, the cylindrical axial component is
$$
(\nabla\times\mathbf{H})_z=\frac{1}{\rho}\frac{\partial(\rho H_\phi)}{\partial\rho}-\frac{1}{\rho}\frac{\partial H_\rho}{\partial\phi}
$$
The formulas must be matched to the coordinate system used to express the field. Exercises D7.4 and D7.5 connect finite circulation approximations with direct curl evaluation in rectangular, cylindrical, and spherical coordinates.

## Page-Grounded Details

#### Page 211

After beginning with Ampère's circuital law equating the closed line integral of H to the current enclosed, we have now arrived at a relationship involving the closed line integral of H per unit area enclosed and the current per unit area enclosed, or current density. We performed a similar analysis in passing from the integral form of Gauss's law, involving flux through a closed surface and charge enclosed, to the point form, relating flux through a closed surface per unit volume enclosed and charge per unit volume enclosed, or volume charge density. In each case a limit is necessary to produce an equality.

If we choose closed paths that are oriented perpendicularly to each of the re- maintaining two coordinate axes, analogous processes lead to expressions for the x and y components of the current density,
$$
\lim_{\Delta y,\Delta z\to 0}\frac{\oint\mathbf{H}\cdot d\mathbf{L}}{\Delta y\Delta z}=\frac{\partial H_{z}}{\partial y}-\frac{\partial H_{y}}{\partial z}=J_{x}\quad{(19)}
$$
and
$$
\lim_{\Delta z,\Delta x\to 0}\frac{\oint\mathbf{H}\cdot d\mathbf{L}}{\Delta z\Delta x}=\frac{\partial H_{x}}{\partial z}-\frac{\partial H_{z}}{\partial x}=J_{y}\quad{(20)}
$$
Comparing (18)-(

[Truncated for analysis]

#### Page 212

This result may be written in the form of a determinant,
$$
\operatorname{curl}H=\begin{vmatrix}a_{x}&a_{y}&a_{z}\\\frac{\partial}{\partial x}&\frac{\partial}{\partial y}&\frac{\partial}{\partial z}\\ H_{x}&H_{y}&H_{z}\end{vmatrix}\quad{(23)}
$$
and may also be written in terms of the vector operator,
$$
\operatorname{curl}H=\nabla\times H\quad{(24)}
$$
Equation (22) is the result of applying the definition (21) to the rectangular coordinate system. We obtained the $z$ component of this expression by evaluating Ampère's circuital law about an incremental path of sides $\Delta x$ and $\Delta y$, and we could have obtained the other two components just as easily by choosing the appropriate paths. Equation (23) is a neat method of storing the rectangular coordinate expres-sion for curl; the form is symmetrical and easily remembered. Equation (24) is even more concise and leads to (22) upon applying the definitions of the cross product and vector operator.
$$ \nabla\times H=\left(\frac{1}{\rho}\frac{\partial H_{z}}{\partial\phi}-\frac{\partial H_{\phi}}{\partial z}\right)\mathbf{a}_{\rho}+\left(\frac{\partial H_{\rho}}{\partial z}-\frac{\partial H_{z}}{\partial\rho}\right)\m

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

- Curl has three components formed from differences of cross-partial derivatives.
- The determinant is a mnemonic for the rectangular-coordinate expansion.
- The concise operator notation is $\nabla\times\mathbf{H}$.
- Cylindrical-coordinate curl contains factors of $\rho$.
- Spherical-coordinate curl contains factors of $r$ and $\sin\theta$.
- The chosen formula must match the coordinate basis of the field.
- Curl evaluation provides current density through the point form of Ampere's law.

## Source Anchors

- Page 211 gives the full rectangular-coordinate curl expansion.
- Page 212 gives the determinant representation of curl.
- Page 212 writes $\operatorname{curl}\mathbf{H}=\nabla\times\mathbf{H}$.
- Page 212 provides the cylindrical-coordinate formula for $\nabla\times\mathbf{H}$.
- Page 212 provides the spherical-coordinate formula for $\nabla\times\mathbf{H}$.
- Page 216 exercise D7.4 compares finite circulation per area with the curl at the rectangle center.
- Page 216 exercise D7.5 asks for current density from curl in three coordinate systems.

## Related Pages

- [[curl-circulation-per-unit-area|Curl as Circulation per Unit Area]]
- [[physical-meaning-of-curl|Physical Meaning of Curl]]
- [[point-form-of-amperes-law|Point Form of Ampere's Law]]

## Concept Dependencies

- derives-from: [[curl-circulation-per-unit-area|Curl as Circulation per Unit Area]]
- enables: [[point-form-of-amperes-law|Point Form of Ampere's Law]]
