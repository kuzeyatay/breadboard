---
title: "1.22 Rectangular and Cylindrical Point Transformations"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 28", "Section: 1.8.4 Point Transformations", "Figure 1.7", "Page 29", "Page 30", "Problem D1.5"]
related: ["cylindrical-coordinates-and-coordinate-surfaces", "vector-component-transformation-by-projection", "rectangular-and-spherical-point-transformations"]
---

# 1.22 Rectangular and Cylindrical Point Transformations

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 28, Section: 1.8.4 Point Transformations, Figure 1.7, Page 29, Page 30, Problem D1.5

Rectangular and cylindrical point coordinates describe the same physical point using different variables. Projection of the radial distance $\rho$ onto the rectangular axes gives $x=\rho\cos\phi$ and $y=\rho\sin\phi$, while the axial coordinate remains unchanged. Conversely, $\rho=\sqrt{x^2+y^2}$ and $\phi$ is determined from the ratio $y/x$ together with the signs of $x$ and $y$. The sign inspection is essential because a basic inverse tangent does not uniquely identify the quadrant. The source illustrates this with $(-3,4)$, which gives $\rho=5$ and $\phi=126.9^\circ$, and $(3,-4)$, which permits $\phi=-53.1^\circ$ or $306.9^\circ$. Scalar functions can be transformed by substituting these variable relations directly. Figure 1.7 provides the geometric source for both the coordinate equations and the later basis-vector projections.

## Page-Grounded Details

#### Page 28

#### 1.8.3 Differential Area and Volume

A differential volume element in cylindrical coordinates may be obtained by increasing $\rho$, $\phi$, and $z$ by the differential increments $d\rho$, $d\phi$, and $dz$. The two cylinders of radius $\rho$ and $\rho+d\rho$, the two radial planes at angles $\phi$ and $\phi+d\phi$, and the two "horizontal" planes at "elevations" $z$ and $z+dz$ now enclose a small volume, as shown in Figure 1.6$c$, having the shape of a truncated wedge. As the volume element becomes very small, its shape approaches that of a rectangular parallelepiped having sides of length $d\rho$, $\rho d\phi$, and $dz$. Note that $d\rho$ and $dz$ are dimensionally lengths, but $d\phi$ is not; $\rho d\phi$ is the length. The surfaces have areas of $\rho\,d\rho\,d\phi$, $d\rho\,dz$, and $\rho\,d\phi\,dz$, and the volume is the product of the three side lengths, or $\rho\,d\rho\,d\phi\,dz$.

#### 1.8.4 Point Transformations

The variables of the rectangular and cylindrical coordinate systems are easily related to each other. Referring to Figure 1.7, we see that
$$
x=\rho\cos\phi
$$
$$
y=\rho\sin\phi
$$
$$
z=z
$$
(10)

From the

[Truncated for analysis]

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
$$ \begin{array} { r l } & { B \rho = B \cdot a_{\rho}= y (a_{x} \cdot a_{\rho}) - x (a_{y} \cdot a_{\rho} ) } \\ & { \qquad= y \cos \phi - x \sin \phi= \rho \sin \phi \cos \phi - \rho \cos \phi \sin \phi= 0 } \\ & { B_{\phi}= B \cdot a_{\phi}= y (a_{x} \cdot a_{\phi}) - x (a_{y} \cdot a_{\phi} ) } \\ & { \qquad= - y \sin \phi - x \cos \phi= - \rho \sin^{2} \phi - \rho \cos^{2} \phi= - \rho }

[Truncated for analysis]

## Core Ideas

- Use $x=\rho\cos\phi$.
- Use $y=\rho\sin\phi$.
- The relation $z=z$ means the axial variable is unchanged.
- Use $\rho=\sqrt{x^2+y^2}$ with $\rho\geq 0$.
- Use $\phi=\tan^{-1}(y/x)$ only with a quadrant check.
- Equivalent positive and negative angle representations may be chosen for convenience.
- Transform scalar functions by substituting the point-coordinate relations.

## Source Anchors

- Equations (10) state $x=\rho\cos\phi$, $y=\rho\sin\phi$, and $z=z$.
- Equations (11) state $\rho=\sqrt{x^2+y^2}$ and $\phi=\tan^{-1}(y/x)$.
- Figure 1.7 displays the relationship between the rectangular and cylindrical variables.
- For $x=-3$, $y=4$, the source obtains $\rho=5$ and $\phi=126.9^\circ$.
- For $x=3$, $y=-4$, the source obtains $\phi=-53.1^\circ$ or $306.9^\circ$.
- D1.5 includes point conversion in both directions and a distance calculation.

## Related Pages

- [[cylindrical-coordinates-and-coordinate-surfaces|Cylindrical Coordinates and Coordinate Surfaces]]
- [[vector-component-transformation-by-projection|Vector Component Transformation by Projection]]
- [[rectangular-and-spherical-point-transformations|Rectangular and Spherical Point Transformations]]

## Concept Dependencies

- depends-on: [[cylindrical-coordinates-and-coordinate-surfaces|Cylindrical Coordinates and Coordinate Surfaces]]
- contrasts-with: [[rectangular-and-spherical-point-transformations|Rectangular and Spherical Point Transformations]]
