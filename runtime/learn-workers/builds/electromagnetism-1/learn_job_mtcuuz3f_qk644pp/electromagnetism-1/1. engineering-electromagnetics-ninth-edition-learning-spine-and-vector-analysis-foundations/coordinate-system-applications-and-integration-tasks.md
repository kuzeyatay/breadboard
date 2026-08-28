---
title: "1.30 Coordinate-System Applications and Integration Tasks"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 35", "Problem 1.9", "Page 36", "Problems 1.16 and 1.18-1.23", "Page 37", "Problems 1.25-1.30"]
related: ["cylindrical-differential-lengths-areas-and-volume", "spherical-differential-lengths-areas-and-volume", "worked-curvilinear-vector-field-transformations", "geometric-procedures-using-dot-and-cross-products"]
---

# 1.30 Coordinate-System Applications and Integration Tasks

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 35, Problem 1.9, Page 36, Problems 1.16 and 1.18-1.23, Page 37, Problems 1.25-1.30

The later Chapter 1 problems apply coordinate transformations and differential geometry to reusable physical and mathematical tasks. These include expressing inverse-square radial fields in cylindrical and rectangular coordinates, converting azimuthal fields, resolving uniform fields into cylindrical or spherical components, and identifying surfaces or axes on which dipole-field components simplify. Other problems use spherical components for a rotating sphere, separate a field into components normal and tangent to a spherical surface, and compute geometric properties of a region bounded by constant cylindrical-coordinate surfaces. A field integral on a fixed plane illustrates that the dot product selects the component normal to the integration surface. The wind-field problem treats a spatially varying vector field as a point function and asks for extrema of tailwind, headwind, and crosswind components. Collectively, these tasks reinforce choosing coordinates that match symmetry and interpreting components geometrically.

## Page-Grounded Details

#### Page 35

$2\mathbf{B}-\mathbf{A}=\mathbf{C}+\mathbf{D}$, find the magnitudes and directions of $\mathbf{C}$ and $\mathbf{D}$. Take north as the positive $y$ direction.

1.2

Vector $\mathbf{A}$ extends from the origin to $(1,2,3)$, and vector $\mathbf{B}$ extends from the origin to $(2,3,-2)$. Find $(a)$ the unit vector in the direction of $(\mathbf{A}-\mathbf{B})$; $(b)$ the unit vector in the direction of the line extending from the origin to the midpoint of the line joining the ends of $\mathbf{A}$ and $\mathbf{B}$.

1.3

The vector from the origin to point $A$ is given as $(6,-2,-4)$, and the unit vector directed from the origin toward point $B$ is $(2,-2,1)/3$. If points $A$ and $B$ are ten units apart, find the coordinates of point $B$.

1.4

A circle, centered at the origin with a radius of 2 units, lies in the $xy$ plane. Determine the unit vector in rectangular components that lies in the $xy$ plane, is tangent to the circle at $(\sqrt{3},-1,0)$, and is in the general direction of increasing values of $x$.

1.5

An equilateral triangle lies in the $xy$ plane with its centroid at the origin. One vertex lies on the positive $y$ axis

[Truncated for analysis]

#### Page 36

1.14  Given that $\mathbf{A + B + C = 0}$, where the three vectors represent line segments and extend from a common origin, must the three vectors be coplanar? If $\mathbf{A + B + C + D = 0}$, are the four vectors coplanar?

1.15  Three vectors extending from the origin are given as $\mathbf{r_{1}} = (7, 3, -2)$, $\mathbf{r_{2}} = (-2, 7, -3)$, and $\mathbf{r_{3}} = (0, 2, 3)$. Find $(a)$ a unit vector perpendicular to both $\mathbf{r_{1}}$ and $\mathbf{r_{2}}$; $(b)$ a unit vector perpendicular to the vectors $\mathbf{r_{1}} - \mathbf{r_{2}}$ and $\mathbf{r_{2}} - \mathbf{r_{3}}$; $(c)$ the area of the triangle defined by $\mathbf{r_{1}}$ and $\mathbf{r_{2}}$; $(d)$ the area of the triangle defined by the heads of $\mathbf{r_{1}}$, $\mathbf{r_{2}}$, and $\mathbf{r_{3}}$.

1.16  In geometrical optics, the path of a light ray can be treated as a vector having the usual three components in a rectangular coordinate system. When light reflects from a plane surface, the effect is to reverse the vector component of the ray that is normal to that surface. This yields a reflection angle that is equal to the incidence angle. Using a vector representation

[Truncated for analysis]

#### Page 37

1.23 The surfaces $\rho=3$, $\rho=5$, $\phi=100^{\circ}$, $\phi=130^{\circ}$, $z=3$, and $z=4.5$ define a closed surface. Find (a) the enclosed volume; (b) the total area of the enclosing surface; (c) the total length of the 12 edges of the surfaces; (d) the length of the longest straight line that lies entirely within the volume.

1.24 Two unit vectors, $\mathbf{a}_{1}$ and $\mathbf{a}_{2}$, lie in the xy plane and pass through the origin. They make angles $\phi_{1}$ and $\phi_{2}$, respectively, with the x axis (a) Express each vector in rectangular components; (b) take the dot product and verify the trigonometric identity, $\cos(\phi_{1}-\phi_{2})=\cos\phi_{1}\cos\phi_{2}+\sin\phi_{1}\sin\phi_{2}$; (c) take the cross product and verify the trigonometric identity $\sin(\phi_{2}-\phi_{1})=\sin\phi_{2}\cos\phi_{1}-\cos\phi_{2}\sin\phi_{1}$.

1.25 Convert the vector field $\mathbf{H}=A(x^{2}+y^{2})^{-1}\left[x\mathbf{a}_{y}-y\mathbf{a}_{x}\right]$ into cylindrical coordinates. A is a constant.

1.26 Express the uniform vector field $\mathbf{F}=10\mathbf{a}_{y}$ in (a) cylindrical components; (b) spherical components.

1.27 The important dipole field (to b

[Truncated for analysis]

## Core Ideas

- Choose cylindrical coordinates for axial or azimuthal symmetry.
- Choose spherical coordinates for radial fields and spherical surfaces.
- Use a dot product with a surface normal to extract a normal field component.
- Subtract the normal component from the full vector to obtain the tangent component.
- Use differential elements derived from coordinate geometry when finding areas and volumes.
- Transform both field variables and basis components.
- Inspect symmetry surfaces and axes for component cancellation.
- Treat a vector field as a location-dependent function when finding extrema or integrals.

## Source Anchors

- Problem 1.9 integrates $\mathbf{G}\cdot\mathbf{a}_y$ over a plane.
- Problem 1.16 models corner-cube reflection by reversing components normal to three orthogonal surfaces.
- Problems 1.18 and 1.19 transform spherical electromagnetic fields into rectangular or cylindrical coordinates.
- Problem 1.22 develops the tangential velocity field of a rotating sphere.
- Problem 1.23 asks for volume, surface area, edge length, and longest internal line in a cylindrical wedge.
- Problems 1.25 through 1.29 transform azimuthal, uniform, dipole, and spherical-surface fields.
- Problem 1.30 asks for extrema of tailwind, headwind, and crosswind in a spatially varying velocity field.

## Related Pages

- [[cylindrical-differential-lengths-areas-and-volume|Cylindrical Differential Lengths, Areas, and Volume]]
- [[spherical-differential-lengths-areas-and-volume|Spherical Differential Lengths, Areas, and Volume]]
- [[worked-curvilinear-vector-field-transformations|Worked Curvilinear Vector-Field Transformations]]
- [[geometric-procedures-using-dot-and-cross-products|Geometric Procedures Using Dot and Cross Products]]

## Concept Dependencies

- depends-on: [[worked-curvilinear-vector-field-transformations|Worked Curvilinear Vector-Field Transformations]]
- applies-to: [[cylindrical-differential-lengths-areas-and-volume|Cylindrical Differential Lengths, Areas, and Volume]]
- applies-to: [[spherical-differential-lengths-areas-and-volume|Spherical Differential Lengths, Areas, and Volume]]
