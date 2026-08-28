---
title: "1.114 Physical Meaning of Curl"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 212", "Page 213", "Page 214", "Section 7.3.2: Physical Meaning of Curl", "Figure S1.P213.F1"]
related: ["curl-circulation-per-unit-area", "coordinate-formulas-for-curl", "magnetic-field-infinite-straight-current-filament", "point-form-of-amperes-law"]
---

# 1.114 Physical Meaning of Curl

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 212, Page 213, Page 214, Section 7.3.2: Physical Meaning of Curl, Figure S1.P213.F1

Curl measures local circulation density rather than merely the visual curvature of field lines. A small paddle wheel provides the physical analogy: no rotation indicates zero curl about its axis, greater torque indicates a larger curl component, and reversal of rotation indicates a sign reversal. The full curl direction is the wheel-axis orientation producing the greatest torque, with its sign determined by the right-hand rule. A river whose speed increases from the bottom toward the surface rotates such a wheel because opposite blades encounter different velocities. By contrast, the magnetic field around an infinite filament has curved circular streamlines but zero curl everywhere away from the filament. Substituting $\mathbf{H}=(I/2\pi\rho)\mathbf{a}_\phi$ into the cylindrical formula gives
$$
\nabla\times\mathbf{H}=\frac{1}{\rho}\frac{\partial(\rho H_\phi)}{\partial\rho}\mathbf{a}_z=0
$$
because $\rho H_\phi=I/(2\pi)$ is constant. Curved field lines therefore do not by themselves imply nonzero curl.

## Page-Grounded Details

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
$$
\nabla\times H=\left(\frac{1}{\rho}\frac{\partial H_{z}}{\partial\phi}-\frac{\partial H_{\phi}}{\partial z}\right)\mathbf{a}_{\rho}+\left(\frac{\partial H_{\rho}}{\partial z}-\frac{\partial H_{z}}{\partial\rho}\right)\m

[Truncated for analysis]

#### Page 213

Figure 7.14 (a) The curl meter shows a component of the curl of the water velocity into the page. (b) The curl of the magnetic field intensity about an infinitely long filament is shown.

The circulation of $\mathbf{H}$, or $\oint\mathbf{H}\cdot d\mathbf{L}$, is obtained by multiplying the component of $\mathbf{H}$ parallel to the specified closed path at each point along it by the differential path length and summing the results as the differential lengths approach zero and as their number becomes infinite. We do not require a vanishingly small path. Ampère's circuit law tells us that if $\mathbf{H}$ does possess circulation about a given path, then current passes through this path. In electrostatics we see that the circulation of $\mathbf{E}$ is zero about every path, a direct consequence of the fact that zero work is required to carry a charge around a closed path.

We may describe curl as _circulation per unit area_. The closed path is vanishingly small, and curl is defined at a point. The curl of $\mathbf{E}$ must be zero, for the circulation is zero. The curl of $\mathbf{H}$ is not zero, however; the circulation of $\mathbf{H}$ per unit area is the current den

[Truncated for analysis]

#### Page 214

direction of an inward normal to the surface of the page. If the velocity of water does not change as we go up- or downstream and also shows no variation as we go across the river (or even if it decreases in the same fashion toward either bank), then this component is the only component present at the center of the stream, and the curl of the water velocity has a direction into the page.

In Figure 7.14b, the streamlines of the magnetic field intensity about an infinitely long filamentary conductor are shown. The curl meter placed in this field of curved lines shows that a larger number of blades have a clockwise force exerted on them but that this force is in general smaller than the counterclockwise force exerted on the smaller number of blades closer to the wire. It seems possible that if the curvature of the streamlines is correct and also if the variation of the field strength is just right, the net torque on the paddle wheel may be zero. Actually, the paddle wheel does not rotate in this case, for since $\mathbf{H}=(I/2\pi\rho)\mathbf{a}_{\phi}$, we may substitute into (25) obtaining
$$
 \mathrm{curl}~{}\mathbf{H}=-\frac{\partial H_{\phi}}{\partial z}\mathbf{a}_{\rho}+\frac

[Truncated for analysis]

## Core Ideas

- Curl is local circulation per unit area.
- The paddle-wheel analogy tests the rotational tendency of a vector field.
- Curl direction follows the paddle-wheel axis and the right-hand rule.
- Velocity shear in a river can produce nonzero curl.
- Curved streamlines do not necessarily imply nonzero curl.
- The infinite-filament field has zero curl at points away from the current.
- For magnetostatic fields, nonzero curl corresponds locally to current density.

## Source Anchors

- Page 213 defines circulation as the closed line integral of a field.
- Page 213 describes curl as circulation per unit area at a point.
- Figure S1.P213.F1 shows a paddle-wheel curl meter in a river velocity field and in the field around a filament.
- Pages 213-214 explain how rotation magnitude and direction indicate curl magnitude and sign.
- Page 214 notes that the filament field's curved lines can still produce zero net paddle-wheel torque.
- Page 214 substitutes $H_\phi=I/(2\pi\rho)$ into the cylindrical curl formula and obtains zero.

## Related Pages

- [[curl-circulation-per-unit-area|Curl as Circulation per Unit Area]]
- [[coordinate-formulas-for-curl|Coordinate Formulas for Curl]]
- [[magnetic-field-infinite-straight-current-filament|Magnetic Field of an Infinite Straight Current Filament]]
- [[point-form-of-amperes-law|Point Form of Ampere's Law]]

## Concept Dependencies

- related: [[curl-circulation-per-unit-area|Curl as Circulation per Unit Area]]
- applies-to: [[magnetic-field-infinite-straight-current-filament|Magnetic Field of an Infinite Straight Current Filament]]
