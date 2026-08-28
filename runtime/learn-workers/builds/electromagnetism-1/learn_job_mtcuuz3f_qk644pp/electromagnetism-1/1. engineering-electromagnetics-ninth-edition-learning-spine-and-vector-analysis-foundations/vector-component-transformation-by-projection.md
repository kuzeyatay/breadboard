---
title: "1.23 Vector Component Transformation by Projection"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 29", "Section: 1.8.5 Vector Component Transformations", "Page 30", "Table 1.1", "Problems D1.6", "Page 33", "Section: 1.9.5 Vector Component Transformations", "Table 1.2"]
related: ["right-handed-curvilinear-unit-vector-bases", "rectangular-and-cylindrical-point-transformations", "rectangular-and-spherical-point-transformations", "worked-curvilinear-vector-field-transformations", "spherical-and-rectangular-basis-transformation-table"]
---

# 1.23 Vector Component Transformation by Projection

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 29, Section: 1.8.5 Vector Component Transformations, Page 30, Table 1.1, Problems D1.6, Page 33, Section: 1.9.5 Vector Component Transformations, Table 1.2

Transforming a vector field requires more than changing its coordinate variables because the basis vectors also change. The source separates the task into two independent operations: substitute the point-coordinate relations, and project the vector onto the destination basis. A component in any unit-vector direction is obtained by a dot product. For cylindrical coordinates, $A_\rho=\mathbf{A}\cdot\mathbf{a}_\rho$, $A_\phi=\mathbf{A}\cdot\mathbf{a}_\phi$, and $A_z$ remains the rectangular $z$ component. Table 1.1 supplies the required basis dot products, including $\mathbf{a}_x\cdot\mathbf{a}_\rho=\cos\phi$, $\mathbf{a}_y\cdot\mathbf{a}_\rho=\sin\phi$, $\mathbf{a}_x\cdot\mathbf{a}_\phi=-\sin\phi$, and $\mathbf{a}_y\cdot\mathbf{a}_\phi=\cos\phi$. Variable substitution and component projection may be performed in either order. This projection method extends directly to spherical transformations through Table 1.2.

## Page-Grounded Details

#### Page 29

We consider the variable $\rho$ to be positive or zero, thus using only the positive sign for the radical in (11). The proper value of the angle $\phi$ is determined by inspecting the signs of x and y. Thus, if x = -3 and y = 4, we find that the point lies in the second quadrant so that $\rho=5$ and $\phi=126.9^{\circ}$. For x = 3 and y = -4, we have $\phi=-53.1^{\circ}$ or $306.9^{\circ}$, whichever is more convenient.

Using (10) or (11), scalar functions given in one coordinate system are easily transformed into the other system.

#### 1.8.5 Vector Component Transformations

A vector function in one coordinate system requires two steps in order to transform it to another coordinate system, because a different set of component vectors is generally required. That is, we may be given a rectangular vector
$$
\mathbf{A}=A_{x}\mathbf{a}_{x}+A_{y}\mathbf{a}_{y}+A_{z}\mathbf{a}_{z}
$$
where each component is given as a function of x, y, and z, and we need a vector in cylindrical coordinates
$$
\mathbf{A}=A_{\rho}\mathbf{a}_{\rho}+A_{\phi}\mathbf{a}_{\phi}+A_{z}\mathbf{a}_{z}
$$
where each component is given as a function of $\rho$, $\phi$, and z.

To find any desired

[Truncated for analysis]

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
 \begin{matrix}r = \sqrt{x^{2} + y^{2} + z^{2}} & (r \geq 0) \\ \theta = \cos^{-1}\frac{z}{\sqrt{x^{2} + y^{2} + z^{2}}} & (0^{\circ} \leq \theta \leq 180^{\circ}) \\ \phi = \tan^{-1}\frac{y}{x} & \end{matrix}\quad{(16)} $$
The radius variable r is nonnegative, and $\theta$ is restricted to the range from $0^{\circ}$ to $180^{\circ}$, inclusive. The angles are placed in the proper quadrants by inspecting the signs of x, y, and z.

#### 1.9.5 Vector Component Transformations

The transformation of vectors requires us to determine the products of the unit vectors in rectangular and spherical coordinates. We work out these products from Figure 1.8

[Truncated for analysis]

## Core Ideas

- Change both the variables and the vector basis.
- Find a destination component by dotting the vector with the corresponding destination unit vector.
- $A_\rho=A_x\cos\phi+A_y\sin\phi$.
- $A_\phi=-A_x\sin\phi+A_y\cos\phi$.
- $A_z$ is unchanged between rectangular and cylindrical bases.
- The inverse transformation uses the same table with projections onto rectangular unit vectors.
- Variable substitution and basis conversion can be performed in either order.

## Source Anchors

- Equations (12) through (14) introduce projection onto $\mathbf{a}_\rho$, $\mathbf{a}_\phi$, and $\mathbf{a}_z$.
- Table 1.1 gives all dot products between rectangular and cylindrical unit vectors.
- The angle between $\mathbf{a}_x$ and $\mathbf{a}_\rho$ is identified as $\phi$.
- The angle between $\mathbf{a}_y$ and $\mathbf{a}_\rho$ is identified as $90^\circ-\phi$.
- The source states that variable conversion and component conversion may be done in either order.
- D1.6 practices rectangular-to-cylindrical and cylindrical-to-rectangular component transformations.

## Related Pages

- [[right-handed-curvilinear-unit-vector-bases|Right-Handed Curvilinear Unit-Vector Bases]]
- [[rectangular-and-cylindrical-point-transformations|Rectangular and Cylindrical Point Transformations]]
- [[rectangular-and-spherical-point-transformations|Rectangular and Spherical Point Transformations]]
- [[worked-curvilinear-vector-field-transformations|Worked Curvilinear Vector-Field Transformations]]
- [[spherical-and-rectangular-basis-transformation-table|Spherical and Rectangular Basis Transformation Table]]

## Concept Dependencies

- depends-on: [[rectangular-and-cylindrical-point-transformations|Rectangular and Cylindrical Point Transformations]]
- depends-on: [[right-handed-curvilinear-unit-vector-bases|Right-Handed Curvilinear Unit-Vector Bases]]
- applies-to: [[spherical-and-rectangular-basis-transformation-table|Spherical and Rectangular Basis Transformation Table]]
