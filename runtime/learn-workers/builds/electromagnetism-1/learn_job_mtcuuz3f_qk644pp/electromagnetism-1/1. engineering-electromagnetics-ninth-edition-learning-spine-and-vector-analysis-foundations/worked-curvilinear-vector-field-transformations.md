---
title: "1.24 Worked Curvilinear Vector-Field Transformations"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 30", "Example 1.3", "Page 33", "Example 1.4", "Page 34"]
related: ["vector-component-transformation-by-projection", "rectangular-and-cylindrical-point-transformations", "rectangular-and-spherical-point-transformations", "coordinate-system-applications-and-integration-tasks", "spherical-and-rectangular-basis-transformation-table"]
---

# 1.24 Worked Curvilinear Vector-Field Transformations

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 30, Example 1.3, Page 33, Example 1.4, Page 34

The worked examples demonstrate the full two-stage vector transformation procedure. In Example 1.3, the rectangular field $\mathbf{B}=y\mathbf{a}_x-x\mathbf{a}_y+z\mathbf{a}_z$ is projected onto the cylindrical basis. Substituting $x=\rho\cos\phi$ and $y=\rho\sin\phi$ causes the radial component to cancel, while the azimuthal component becomes $-\rho$. The transformed field is therefore $\mathbf{B}=-\rho\mathbf{a}_\phi+z\mathbf{a}_z$. Example 1.4 transforms $\mathbf{G}=(xz/y)\mathbf{a}_x$ into spherical coordinates. Each spherical component is found by a dot product with $\mathbf{a}_r$, $\mathbf{a}_\theta$, or $\mathbf{a}_\phi$, followed by substitution of the spherical point relations. These examples show that a field's apparent complexity can change substantially when its basis is aligned with its geometry.

## Page-Grounded Details

#### Page 30

Table 1.1 Dot products of unit vectors in cylindrical and rectangular coordinate systems

<table><tr><td></td><td>$a_{\rho}$</td><td>$a_{\phi}$</td><td>$a_{z}$</td></tr><tr><td>$a_{x}$</td><td>$\cos\phi$</td><td>$-\sin\phi$</td><td>0</td></tr><tr><td>$a_{y}$</td><td>$\sin\phi$</td><td>$\cos\phi$</td><td>0</td></tr><tr><td>$a_{z}$</td><td>0</td><td>0</td><td>1</td></tr></table>

Transforming vectors from rectangular to cylindrical coordinates or vice versa is therefore accomplished by using (10) or (11) to change variables, and by using the dot products of the unit vectors given in Table 1.1 to change components. The two steps may be taken in either order.

### EXAMPLE 1.3

Transform the vector $B = y a_{x} - x a_{y} + z a_{z}$ into cylindrical coordinates.

Solution. The new components are
$$
\begin{array} { r l } & { B \rho = B \cdot a_{\rho}= y (a_{x} \cdot a_{\rho}) - x (a_{y} \cdot a_{\rho} ) } \\ & { \qquad= y \cos \phi - x \sin \phi= \rho \sin \phi \cos \phi - \rho \cos \phi \sin \phi= 0 } \\ & { B_{\phi}= B \cdot a_{\phi}= y (a_{x} \cdot a_{\phi}) - x (a_{y} \cdot a_{\phi} ) } \\ & { \qquad= - y \sin \phi - x \cos \phi= - \rho \sin^{2} \phi - \rho \cos^{2} \phi= - \rho }

[Truncated for analysis]

#### Page 33

Table 1.2 Dot products of unit vectors in spherical and rectangular coordinate systems

<table><tr><td></td><td>$a_r$</td><td>$a_\theta$</td><td>$a_\phi$</td></tr><tr><td>$a_x\cdot$</td><td>$\sin\theta\cos\phi$</td><td>$\cos\theta\cos\phi$</td><td>$-\sin\phi$</td></tr><tr><td>$a_y\cdot$</td><td>$\sin\theta\sin\phi$</td><td>$\cos\theta\sin\phi$</td><td>$\cos\phi$</td></tr><tr><td>$a_z\cdot$</td><td>$\cos\theta$</td><td>$-\sin\theta$</td><td>0</td></tr></table>

The transformation in the reverse direction is achieved with the help of
$$
 \begin{matrix}r = \sqrt{x^{2} + y^{2} + z^{2}} & (r \geq 0) \\ \theta = \cos^{-1}\frac{z}{\sqrt{x^{2} + y^{2} + z^{2}}} & (0^{\circ} \leq \theta \leq 180^{\circ}) \\ \phi = \tan^{-1}\frac{y}{x} & \end{matrix}\quad{(16)}
$$
The radius variable r is nonnegative, and $\theta$ is restricted to the range from $0^{\circ}$ to $180^{\circ}$, inclusive. The angles are placed in the proper quadrants by inspecting the signs of x, y, and z.

#### 1.9.5 Vector Component Transformations

The transformation of vectors requires us to determine the products of the unit vectors in rectangular and spherical coordinates. We work out these products from Figure 1.8

[Truncated for analysis]

#### Page 34
$$
 \begin{align*}G_{\theta}&=G\cdot a_{\theta}=\frac{xz}{y} a_{x}\cdot a_{\theta}=\frac{xz}{y}\cos\theta\cos\phi\\&=r\cos^{2}\theta\frac{\cos^{2}\phi}{\sin\phi}\\ G_{\phi}&=G\cdot a_{\phi}=\frac{xz}{y}a_{x}\cdot a_{\phi}=\frac{xz}{y}(-\sin\phi)\\&=-r\cos\theta\cos\phi\end{align*}
$$
Collecting these results, we have
$$
 G=r\cos\theta\cos\phi(\sin\theta\cot\phi a_{r}+\cos\theta\cot\phi a_{\theta}-a_{\phi}) $$
Appendix A describes the general curvilinear coordinate system of which the rectangular, circular cylindrical, and spherical coordinate systems are special cases. The first section of this appendix could well be scanned now.

D1.7. Given the two points, C(-3, 2, 1) and D(r=5, $\theta=20^{\circ}$ , $\phi=-70^{\circ}$ ), find: (a) the spherical coordinates of C; (b) the rectangular coordinates of D; (c) the distance from C to D.

Ans. (a) C(r=3.74, $\theta=74.5^{\circ}$ , $\phi=146.3^{\circ}$ ); (b) D(x=0.585, y=-1.607, z=4.70); (c) 6.29

D1.8. Transform the following vectors to spherical coordinates at the points given: (a) $10a_{x}$ at P(x=-3, y=2, z=4); (b) $10a_{y}$ at Q($\rho=5$, $\phi=30^{\circ}$, z=4); (c) $10a_{z}$ at M(r=4, $\theta=110^{\circ}$, $ \

[Truncated for analysis]

## Core Ideas

- Project first or substitute variables first, but complete both operations.
- A zero transformed component can emerge through exact trigonometric cancellation.
- Example 1.3 produces $B_\rho=0$ and $B_\phi=-\rho$.
- The cylindrical result is $\mathbf{B}=-\rho\mathbf{a}_\phi+z\mathbf{a}_z$.
- Example 1.4 begins with a field having only a rectangular $x$ component.
- A single rectangular component generally contributes to all three spherical components.
- Factorization can reveal shared geometric dependence after transformation.

## Source Anchors

- Example 1.3 evaluates $B_\rho=y\cos\phi-x\sin\phi=0$.
- Example 1.3 evaluates $B_\phi=-y\sin\phi-x\cos\phi=-\rho$.
- Example 1.4 obtains $G_r=r\sin\theta\cos\theta\cos^2\phi/\sin\phi$.
- Example 1.4 obtains $G_\theta=r\cos^2\theta\cos^2\phi/\sin\phi$.
- Example 1.4 obtains $G_\phi=-r\cos\theta\cos\phi$.
- The collected result is $\mathbf{G}=r\cos\theta\cos\phi(\sin\theta\cot\phi\,\mathbf{a}_r+\cos\theta\cot\phi\,\mathbf{a}_\theta-\mathbf{a}_\phi)$.

## Related Pages

- [[vector-component-transformation-by-projection|Vector Component Transformation by Projection]]
- [[rectangular-and-cylindrical-point-transformations|Rectangular and Cylindrical Point Transformations]]
- [[rectangular-and-spherical-point-transformations|Rectangular and Spherical Point Transformations]]
- [[coordinate-system-applications-and-integration-tasks|Coordinate-System Applications and Integration Tasks]]
- [[spherical-and-rectangular-basis-transformation-table|Spherical and Rectangular Basis Transformation Table]]

## Concept Dependencies

- example-of: [[vector-component-transformation-by-projection|Vector Component Transformation by Projection]]
- applies-to: [[rectangular-and-cylindrical-point-transformations|Rectangular and Cylindrical Point Transformations]]
- applies-to: [[spherical-and-rectangular-basis-transformation-table|Spherical and Rectangular Basis Transformation Table]]
