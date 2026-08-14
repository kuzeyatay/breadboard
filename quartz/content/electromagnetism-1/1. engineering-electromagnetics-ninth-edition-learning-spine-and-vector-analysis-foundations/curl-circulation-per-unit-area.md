---
title: "1.112 Curl as Circulation per Unit Area"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 209", "Page 210", "Page 211", "Section 7.3: Curl", "Section 7.3.1: Development and Definition of Curl", "Figure S1.P210.F1"]
related: ["ampere-circuital-law-enclosed-current", "coordinate-formulas-for-curl", "physical-meaning-of-curl", "point-form-of-amperes-law"]
---

# 1.112 Curl as Circulation per Unit Area

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 209, Page 210, Page 211, Section 7.3: Curl, Section 7.3.1: Development and Definition of Curl, Figure S1.P210.F1

Curl is derived by applying Ampere's circuital law to a shrinking rectangular path. For a rectangle of sides $\Delta x$ and $\Delta y$ traversed with right-hand normal $\mathbf{a}_z$, first-order expansions of the field components on the four sides give
$$
\oint\mathbf{H}\cdot d\mathbf{L}\approx\left(\frac{\partial H_y}{\partial x}-\frac{\partial H_x}{\partial y}\right)\Delta x\Delta y
$$
The enclosed current is approximately $J_z\Delta x\Delta y$. Dividing by area and taking the limit yields
$$
\frac{\partial H_y}{\partial x}-\frac{\partial H_x}{\partial y}=J_z
$$
Analogous loops normal to the other coordinate axes produce the other components. In coordinate-independent language,
$$
(\operatorname{curl}\mathbf{H})_N=\lim_{\Delta S_N\to0}\frac{\oint\mathbf{H}\cdot d\mathbf{L}}{\Delta S_N}
$$
Curl is therefore a vector whose component normal to a small surface equals circulation per unit area around that surface. The path direction and selected normal are connected by the right-hand rule.

## Page-Grounded Details

#### Page 209

Figure 7.12 (a) An ideal toroid carrying a surface current $\mathbf{K}$ in the direction shown. (b) An N-turn toroid carrying a filamentary current I.

D7.3. Express the value of $\mathbf{H}$ in rectangular components at $P(0,0.2,0)$ in the field of: (a) a current filament, 2.5 A in the $\mathbf{a}_{z}$ direction at $x=0.1,y=0.3$; (b) a coax, centered on the z axis, with $a=0.3,b=0.5,c=0.6,I=2.5$ A in the $\mathbf{a}_{z}$ direction in the center conductor; (c) three current sheets, $2.7\mathbf{a}_{x}$ A/m at $y=0.1,-1.4\mathbf{a}_{x}$ A/m at $y=0.15$, and $-1.3\mathbf{a}_{x}$ A/m at $y=0.25$.

Ans. (a) $1.989\mathbf{a}_{x}-1.989\mathbf{a}_{y}$ A/m; (b) $-0.884\mathbf{a}_{x}$ A/m; (c) $1.300\mathbf{a}_{z}$ A/m

#### 7.3 CURL

We completed our study of Gauss's law by applying it to a differential volume element and were led to the concept of divergence. We now apply Ampère's circuital law to the perimeter of a differential surface element and discuss the third and last of the special derivatives of vector analysis, the curl. Our objective is to obtain the point form of Ampère's circuital law.

#### 7.3.1 Development and Definition of Curl

Again we choos

[Truncated for analysis]

#### Page 210

Figure 7.13 An incremental closed path in rectangular coordinates is selected for the application of Ampère's circuital law to determine the spatial rate of change of H.

The value of $H_{y}$ on this section of the path may be given in terms of the reference value $H_{y0}$ at the center of the rectangle, the rate of change of $H_{y}$ with x, and the distance $\Delta x/2$ from the center to the midpoint of side 1-2:
$$
H_{y,1-2}\doteq H_{y0}+\frac{\partial H_{y}}{\partial x}\left(\frac{1}{2}\Delta x\right)
$$
Thus
$$
(H\cdot\Delta L)_{1-2}\doteq\left(H_{y0}+\frac{1}{2}\frac{\partial H_{y}}{\partial x}\Delta x\right)\Delta y
$$
Along the next section of the path we have
$$
(H\cdot\Delta L)_{2-3}\doteq H_{x,2-3}(-\Delta x)\doteq-\left(H_{x0}+\frac{1}{2}\frac{\partial H_{x}}{\partial y}\Delta y\right)\Delta x
$$
Continuing for the remaining two segments and adding the results,
$$
\oint\mathbf{H}\cdot d\mathbf{L}\doteq\left(\frac{\partial H_{y}}{\partial x}-\frac{\partial H_{x}}{\partial y}\right)\Delta x\Delta y
$$
By Ampère's circuital law, this result must be equal to the current enclosed by the path, or the current crossing any surface bounded by the path. If we assu

[Truncated for analysis]

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

## Core Ideas

- Curl is defined locally by circulation around a shrinking path divided by enclosed area.
- The selected curl component is normal to the small planar surface.
- First-order field variations on opposite sides produce differences of partial derivatives.
- For an $xy$ loop, $(\nabla\times\mathbf{H})_z=\partial H_y/\partial x-\partial H_x/\partial y$.
- Ampere's law identifies this component with $J_z$.
- The geometric definition is independent of a particular coordinate system.
- The finite-path circulation becomes an exact local derivative only in the zero-area limit.

## Source Anchors

- Figure S1.P210.F1 shows the incremental rectangular path used to determine spatial variation of $\mathbf{H}$.
- Pages 209-210 expand the field components about the center of the rectangle.
- Page 210 obtains $\oint\mathbf{H}\cdot d\mathbf{L}\approx(\partial H_y/\partial x-\partial H_x/\partial y)\Delta x\Delta y$.
- Page 210 identifies the enclosed current as $J_z\Delta x\Delta y$.
- Page 211 gives the analogous $J_x$ and $J_y$ expressions.
- Page 211 defines $(\operatorname{curl}\mathbf{H})_N$ as the limiting circulation per unit area.

## Related Pages

- [[ampere-circuital-law-enclosed-current|Ampere's Circuital Law and Enclosed Current]]
- [[coordinate-formulas-for-curl|Coordinate Formulas for Curl]]
- [[physical-meaning-of-curl|Physical Meaning of Curl]]
- [[point-form-of-amperes-law|Point Form of Ampere's Law]]

## Concept Dependencies

- derives-from: [[ampere-circuital-law-enclosed-current|Ampere's Circuital Law and Enclosed Current]]
