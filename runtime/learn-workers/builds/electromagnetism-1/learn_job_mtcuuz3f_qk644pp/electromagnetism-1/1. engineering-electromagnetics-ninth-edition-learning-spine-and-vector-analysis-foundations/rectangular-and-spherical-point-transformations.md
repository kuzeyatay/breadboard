---
title: "1.27 Rectangular and Spherical Point Transformations"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 32", "Section: 1.9.4 Point Transformations", "Page 33", "Equation (16)", "Page 34", "Problems D1.7 and D1.8"]
related: ["spherical-coordinates-and-coordinate-surfaces", "vector-component-transformation-by-projection", "worked-curvilinear-vector-field-transformations"]
---

# 1.27 Rectangular and Spherical Point Transformations

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 32, Section: 1.9.4 Point Transformations, Page 33, Equation (16), Page 34, Problems D1.7 and D1.8

Spherical-to-rectangular conversion resolves the radial distance into its projection on the $xy$ plane and then into $x$ and $y$ components. The resulting equations are $x=r\sin\theta\cos\phi$, $y=r\sin\theta\sin\phi$, and $z=r\cos\theta$. The reverse transformation uses the Euclidean distance $r=\sqrt{x^2+y^2+z^2}$, the polar-angle relation $\theta=\cos^{-1}(z/r)$, and the azimuth relation $\phi=\tan^{-1}(y/x)$ with quadrant inspection. The source restricts $r\geq0$ and $0^\circ\leq\theta\leq180^\circ$. These range conventions prevent multiple spherical descriptions from being treated as distinct points. As in cylindrical coordinates, the signs of the rectangular coordinates must be inspected to place angles in the proper quadrants. Problems D1.7 and D1.8 combine point conversion, distance calculation, and vector transformation.

## Page-Grounded Details

#### Page 32

The third coordinate $\phi$ is also an angle and is exactly the same as the angle $\phi$ of cylindrical coordinates. It is the angle between the x axis and the projection in the $z=0$ plane of the line drawn from the origin to the point. It corresponds to the angle of longitude, but the angle $\phi$ increases to the "east." The surface $\phi=\mathrm{constant}$ is a plane passing through the $\theta=0$ line (or the z axis).

We again consider any point as the intersection of three mutually perpendicular surfaces-a sphere, a cone, and a plane-each oriented in the manner just described. The three surfaces are shown in Figure 1.8b.

#### 1.9.2 Unit Vectors in Spherical Coordinates

Three unit vectors may again be defined at any point. Each unit vector is perpendicular to one of the three mutually perpendicular surfaces and is oriented in that direction in which the coordinate increases. The unit vector $\mathbf{a}_{r}$ is directed radially outward, normal to the sphere $r=\mathrm{constant}$, and lies in the cone $\theta=\mathrm{constant}$ and the plane $\phi=\mathrm{constant}$. The unit vector $\mathbf{a}_{\theta}$ is normal to the conical surface, lies in the pla

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
G=r\cos\theta\cos\phi(\sin\theta\cot\phi a_{r}+\cos\theta\cot\phi a_{\theta}-a_{\phi})
$$
Appendix A describes the general curvilinear coordinate system of which the rectangular, circular cylindrical, and spherical coordinate systems are special cases. The first section of this appendix could well be scanned now.

D1.7. Given the two points, C(-3, 2, 1) and D(r=5, $\theta=20^{\circ}$ , $\phi=-70^{\circ}$ ), find: (a) the spherical coordinates of C; (b) the rectangular coordinates of D; (c) the distance from C to D.

Ans. (a) C(r=3.74, $\theta=74.5^{\circ}$ , $\phi=146.3^{\circ}$ ); (b) D(x=0.585, y=-1.607, z=4.70); (c) 6.29

D1.8. Transform the following vectors to spherical coordinates at the points given: (a) $10a_{x}$ at P(x=-3, y=2, z=4); (b) $10a_{y}$ at Q($\rho=5$, $\phi=30^{\circ}$, z=4); (c) $10a_{z}$ at M(r=4, $\theta=110^{\circ}$, $ \

[Truncated for analysis]

## Core Ideas

- Use $x=r\sin\theta\cos\phi$.
- Use $y=r\sin\theta\sin\phi$.
- Use $z=r\cos\theta$.
- Use $r=\sqrt{x^2+y^2+z^2}$ with $r\geq0$.
- Use $\theta=\cos^{-1}(z/r)$ with $0^\circ\leq\theta\leq180^\circ$.
- Determine $\phi$ from $y/x$ and the signs of $x$ and $y$.
- Coordinate conversion can be combined with Euclidean distance calculations.

## Source Anchors

- Equation (15) gives the three spherical-to-rectangular relations.
- Equation (16) gives $r$, $\theta$, and $\phi$ in terms of $x$, $y$, and $z$.
- The source explicitly states the ranges of $r$ and $\theta$.
- D1.7 converts point C from rectangular to spherical coordinates and point D from spherical to rectangular coordinates.
- D1.7 reports the distance from C to D as $6.29$.
- D1.8 transforms fixed rectangular unit-direction vectors into spherical components at specified points.

## Related Pages

- [[spherical-coordinates-and-coordinate-surfaces|Spherical Coordinates and Coordinate Surfaces]]
- [[vector-component-transformation-by-projection|Vector Component Transformation by Projection]]
- [[worked-curvilinear-vector-field-transformations|Worked Curvilinear Vector-Field Transformations]]

## Concept Dependencies

- depends-on: [[spherical-coordinates-and-coordinate-surfaces|Spherical Coordinates and Coordinate Surfaces]]
