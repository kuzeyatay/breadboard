---
title: "1.115 Line-Integral Evaluation of Curl"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 214", "Page 215", "Example 7.2", "Figure S1.P214.F1"]
related: ["curl-circulation-per-unit-area", "coordinate-formulas-for-curl", "point-form-of-amperes-law"]
---

# 1.115 Line-Integral Evaluation of Curl

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 214, Page 215, Example 7.2, Figure S1.P214.F1

Example 7.2 demonstrates that curl can be calculated either from its limiting circulation definition or by direct differentiation. The field is $\mathbf{H}=0.2z^2\mathbf{a}_x$ for $z>0$ and zero elsewhere. A square of side $d$, centered at $(0,0,z_1)$ in the $y=0$ plane with $z_1>d/2$, has two sides parallel to the field and two perpendicular to it. Evaluating the four path contributions gives
$$
\oint\mathbf{H}\cdot d\mathbf{L}=0.4z_1d^2
$$
Dividing by the area $d^2$ and taking $d\to0$ yields
$$
(\nabla\times\mathbf{H})_y=0.4z_1
$$
Direct use of the rectangular curl formula gives $\nabla\times\mathbf{H}=0.4z\mathbf{a}_y$, which agrees at $z=z_1$. The example clarifies that finite circulation may be evaluated from path segments, while curl is the limiting circulation density at the point enclosed by a shrinking path.

## Page-Grounded Details

#### Page 214

direction of an inward normal to the surface of the page. If the velocity of water does not change as we go up- or downstream and also shows no variation as we go across the river (or even if it decreases in the same fashion toward either bank), then this component is the only component present at the center of the stream, and the curl of the water velocity has a direction into the page.

In Figure 7.14b, the streamlines of the magnetic field intensity about an infinitely long filamentary conductor are shown. The curl meter placed in this field of curved lines shows that a larger number of blades have a clockwise force exerted on them but that this force is in general smaller than the counterclockwise force exerted on the smaller number of blades closer to the wire. It seems possible that if the curvature of the streamlines is correct and also if the variation of the field strength is just right, the net torque on the paddle wheel may be zero. Actually, the paddle wheel does not rotate in this case, for since $\mathbf{H}=(I/2\pi\rho)\mathbf{a}_{\phi}$, we may substitute into (25) obtaining
$$
\mathrm{curl}~{}\mathbf{H}=-\frac{\partial H_{\phi}}{\partial z}\mathbf{a}_{\rho}+\frac

[Truncated for analysis]

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
 \nabla\times\mathbf{H}=\begin{vmatrix}\mathbf{a}_{x}&\mathbf{a}_{y}&\mathbf{a}_{z}\\\frac{\partial}{\partial x}&\frac{\partial}{\partial y}&\frac{\partial}{\partial z}\\0.2z^{2}&0&0\end{vmatrix}=\frac{\partial}{\partial z}(0.2z^{2})\mathbf{a}_{y}=0.4z\mathbf{a}_{y} $$
which checks with the preceding result when $z=z_{1}$.

Returning now to complete our original examination of the application of Ampère's circuital law to a differential-sized path, we may combine (18)-(20), (22), and (

[Truncated for analysis]

## Core Ideas

- Only path segments parallel to the field contribute to the line integral.
- Opposite parallel sides sample the field at different $z$ values.
- The circulation is $0.4z_1d^2$.
- Dividing by area gives the local curl component in the limit.
- The circulation orientation selects the positive $y$ normal.
- Direct differentiation gives $\nabla\times\mathbf{H}=0.4z\mathbf{a}_y$.
- The definition-based and derivative-based methods agree.

## Source Anchors

- Figure S1.P214.F1 shows the square path centered at $z=z_1$ in the $y=0$ plane.
- Pages 214-215 specify $\mathbf{H}=0.2z^2\mathbf{a}_x$ for $z>0$.
- Page 215 evaluates the four path contributions and obtains $0.4z_1d^2$.
- Page 215 divides by $d^2$ and takes the zero-size limit.
- Page 215 evaluates the rectangular determinant and obtains $0.4z\mathbf{a}_y$.

## Related Pages

- [[curl-circulation-per-unit-area|Curl as Circulation per Unit Area]]
- [[coordinate-formulas-for-curl|Coordinate Formulas for Curl]]
- [[point-form-of-amperes-law|Point Form of Ampere's Law]]

## Concept Dependencies

- example-of: [[curl-circulation-per-unit-area|Curl as Circulation per Unit Area]]
- applies-to: [[coordinate-formulas-for-curl|Coordinate Formulas for Curl]]
