---
title: "1.29 Geometric Procedures Using Dot and Cross Products"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 35", "Chapter 1 Problems 1.1-1.13", "Page 36", "Chapter 1 Problems 1.14-1.20", "Page 37", "Problem 1.24"]
related: ["operational-cross-product-in-rectangular-components", "coordinate-system-applications-and-integration-tasks", "vector-form-of-coulombs-law", "vector-component-transformation-by-projection"]
---

# 1.29 Geometric Procedures Using Dot and Cross Products

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 35, Chapter 1 Problems 1.1-1.13, Page 36, Chapter 1 Problems 1.14-1.20, Page 37, Problem 1.24

The chapter problems organize vector algebra into reusable geometric procedures. Differences of position vectors construct directed line segments, normalization constructs unit directions, and dot products determine scalar projections and angles. Cross products construct normals, test coplanar geometry, and determine areas. A vector can be decomposed into parts parallel and perpendicular to another vector by projection and subtraction. The problem set also highlights conceptual limits: using a cross-product magnitude to infer an angle introduces a supplementary-angle ambiguity because $\sin\theta=\sin(180^\circ-\theta)$, while the dot product distinguishes the angles through the sign of $\cos\theta$. Other tasks use vector addition to derive the law of cosines, compare cube diagonals, construct tangent directions, and analyze whether collections of vectors satisfying a zero-sum relation must be coplanar. These are durable methods rather than isolated numerical exercises.

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

- Construct a displacement with destination position minus source position.
- Normalize a nonzero vector by dividing it by its magnitude.
- Use $\mathbf{A}\cdot\mathbf{B}=|\mathbf{A}||\mathbf{B}|\cos\theta$ to find angles and projections.
- Use $|\mathbf{A}\times\mathbf{B}|=|\mathbf{A}||\mathbf{B}|\sin\theta$ for areas and normals.
- Find the parallel component by projection and the perpendicular component by subtraction.
- The cross-product magnitude alone cannot distinguish supplementary angles.
- Triangle and polygon closure relations can be represented by vector sums.

## Source Anchors

- Problems 1.1 through 1.5 address vector sums, midpoint directions, point locations, tangent vectors, and triangle directions.
- Problems 1.6 and 1.8 compare angle calculations using dot and cross products.
- Problems 1.11 through 1.13 use displacement vectors, scalar projections, angles, and parallel-perpendicular decomposition.
- Problems 1.14, 1.15, and 1.17 address coplanarity, normal vectors, triangle areas, and angle bisectors.
- Problem 1.20 derives the law of cosines from $|\mathbf{C}|^2=(\mathbf{A}+\mathbf{B})\cdot(\mathbf{A}+\mathbf{B})$.
- Problem 1.24 derives angle-difference identities from dot and cross products.

## Related Pages

- [[operational-cross-product-in-rectangular-components|Operational Cross Product in Rectangular Components]]
- [[coordinate-system-applications-and-integration-tasks|Coordinate-System Applications and Integration Tasks]]
- [[vector-form-of-coulombs-law|Vector Form of Coulomb's Law]]
- [[vector-component-transformation-by-projection|Vector Component Transformation by Projection]]

## Concept Dependencies

- related: [[vector-component-transformation-by-projection|Vector Component Transformation by Projection]]
