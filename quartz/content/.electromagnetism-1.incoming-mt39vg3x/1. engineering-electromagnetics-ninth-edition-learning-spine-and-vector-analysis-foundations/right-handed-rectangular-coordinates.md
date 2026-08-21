---
title: "1.7 Right-Handed Rectangular Coordinates"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 15", "Page 16", "Page 17", "Page 24"]
related: ["differential-elements-in-rectangular-coordinates", "rectangular-vector-components-and-unit-vectors", "displacement-vectors-between-points", "cross-product-orientation-and-magnitude"]
source_images: ["/electromagnetism-1/assets/engineering-electromagnetics-9th-ed-9nbsped-compress-page-015.png", "/electromagnetism-1/assets/engineering-electromagnetics-9th-ed-9nbsped-compress-page-016.png"]
---

# 1.7 Right-Handed Rectangular Coordinates

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 15, Page 16, Page 17, Page 24

The rectangular Cartesian coordinate system uses three mutually perpendicular axes labeled $x$, $y$, and $z$. The text adopts a right-handed orientation. If the $x$ axis rotates through the smaller angle toward the $y$ axis, a right-handed screw advances in the positive $z$ direction. Equivalently, the right thumb, forefinger, and middle finger can represent the $x$, $y$, and $z$ axes. A point can be described by its signed distances along the three axes or, more generally, as the common intersection of the surfaces $x=\text{constant}$, $y=\text{constant}$, and $z=\text{constant}$. The surface-intersection interpretation is important because it generalizes to cylindrical and spherical coordinates, where constant-coordinate surfaces need not be planes. Figure 1.2 locates $P(1,2,3)$ and $Q(2,-2,1)$ and depicts the coordinate orientation. The right-handed convention later determines the positive directions of cross products between basis vectors.

## Source Figures and Snapshots

![engineering-electromagnetics-9th-ed-9nbsped_compress Page 15](/electromagnetism-1/assets/engineering-electromagnetics-9th-ed-9nbsped-compress-page-015.png)

![engineering-electromagnetics-9th-ed-9nbsped_compress Page 16](/electromagnetism-1/assets/engineering-electromagnetics-9th-ed-9nbsped-compress-page-016.png)

## Page-Grounded Details

#### Page 15

Figure 1.1 Two vectors may be added graphically either by drawing both vectors from a common origin and completing the parallelogram or by beginning the second vector from the head of the first and completing the triangle; either method is easily extended to three or more vectors.

The rule for the subtraction of vectors follows easily from that for addition, for we may always express $\mathbf{A}-\mathbf{B}$ as $\mathbf{A}+(-\mathbf{B})$; the sign, or direction, of the second vec-or is reversed, and this vector is then added to the first by the rule for vector addition.

#### 1.2.2 Multiplication and Division

Vectors may be multiplied by scalars. The magnitude of the vector changes, but its direction does not when the scalar is positive, although it reverses direction when multiplied by a negative scalar. Multiplication of a vector by a scalar also obeys the associative and distributive laws of algebra, leading to
$$
(r+s)(\mathbf{A}+\mathbf{B})=r(\mathbf{A}+\mathbf{B})+s(\mathbf{A}+\mathbf{B})=r\mathbf{A}+r\mathbf{B}+s\mathbf{A}+s\mathbf{B}
$$
Division of a vector by a scalar is merely multiplication by the reciprocal of that scalar. The multiplication of a vector by a vect

[Truncated for analysis]

#### Page 16

Figure 1.2 (a) A right-handed rectangular coordinate system. If the curved fingers of the right hand indicate the direction through which the $x$ axis is turned into coincidence with the $y$ axis, the thumb shows the direction of the $z$ axis. (b) The location of points $P(1,2,3)$ and $Q(2,-2,1)$. (c) The differential volume element in rectangular coordinates; $dx$, $dy$, and $dz$ are, in general, independent differentials.

middle finger may be identified, respectively, as the $x$, $y$, and $z$ axes. Figure 1.2$a$ shows a right-handed rectangular coordinate system. A point is located by giving its $x$, $y$, and $z$ coordinates. These are, respectively, the distances from the origin to the intersection of perpendicular lines dropped from the point to the $x$, $y$, and $z$ axes.

#### 1.3.2 Point Locations as Intersections of Planes

An alternative method of interpreting coordinate values, which $must$ be used in all other coordinate systems, is to consider a point as being at the common intersection of three surfaces. In rectangular coordinates, these are the planes $x=\text{constant}$, $y=\text{constant}$, and $z=\text{constant}$, where

[Truncated for analysis]

#### Page 17

planes $x=1$ , $y=2$ , and $z=3$ , whereas point Q is located at the intersection of the planes $x=2$ , $y=-2$ , and $z=1$ .

In other coordinate systems, as discussed in Sections 1.8 and 1.9, we expect points to be located at the common intersection of three surfaces, not necessarily planes, but still mutually perpendicular at the point of intersection.

If we visualize three planes intersecting at the general point P, whose coordinates are x,y,and z, we may increase each coordinate value by a differential amount and obtain three slightly displaced planes intersecting at point $P^{\prime}$ , whose coordinates are$x+dx,y+dy$ , and $z+dz$ . The six planes define a rectangular parallelepiped whose volume is $dv=dxdydz$ ; the surfaces have differential areas dS of $dxdy$ , $dydz$ , and$dzdx$ . Finally, the distance $dL$ from P to $P^{\prime}$ is the diagonal of the parallelepiped and has a length of $\sqrt{(dx)^{2}+(dy)^{2}+(dz)^{2}}$ . The volume element is shown in Figure 1.2c;point $P^{\prime}$ is indicated, but point P is located at the only invisible corner.

All this is familiar from trigonometry or solid geometry and as yet involves only scalar

[Truncated for analysis]

#### Page 24

Figure 1.5 The direction of $\mathbf{A} \times \mathbf{B}$ is in the direction of advance of a right-handed screw as $\mathbf{A}$ is turned into $\mathbf{B}$.

As an equation we can write
$$
\mathbf{A} \times \mathbf{B} = \mathbf{a}_N \left| \mathbf{A} \right| \left| \mathbf{B} \right| \sin \theta_{AB}
$$
(7)

where an additional statement, such as that given above, is required to explain the direction of the unit vector $\mathbf{a}_N$. The subscript $N$ stands for "normal."

Reversing the order of the vectors $\mathbf{A}$ and $\mathbf{B}$ results in a unit vector in the opposite direction, and we see that the cross product is not commutative, for $\mathbf{B} \times \mathbf{A} = -(\mathbf{A} \times \mathbf{B})$. If the definition of the cross product is applied to the unit vectors $\mathbf{a}_x$ and $\mathbf{a}_y$, we find $\mathbf{a}_x \times \mathbf{a}_y = \mathbf{a}_z$ for each vector has unit magnitude, the two vectors are perpendicular, and the rotation of $\mathbf{a}_x$ into $\mathbf{a}_y$ indicates the positive $z$ direction by the definition of a right-handed coordinate system. In a similar way, $ \mathbf{a}_y \times \mathbf{a}_z = \mathbf{a}_x

[Truncated for analysis]

## Core Ideas

- The $x$, $y$, and $z$ axes are mutually perpendicular.
- The coordinate system uses a right-handed orientation.
- Rotation from $x$ toward $y$ identifies the positive $z$ direction.
- A point is specified by three coordinate values.
- A rectangular-coordinate point is the intersection of three constant-coordinate planes.
- The intersection-of-surfaces interpretation extends to other coordinate systems.
- Coordinate handedness fixes cross-product orientation.

## Source Anchors

- Figure 1.2(a) shows the right-handed rectangular coordinate system.
- Figure 1.2(b) locates $P(1,2,3)$ and $Q(2,-2,1)$.
- Point $P$ is the intersection of $x=1$, $y=2$, and $z=3$.
- Point $Q$ is the intersection of $x=2$, $y=-2$, and $z=1$.
- The text later states that $\mathbf{a}_x\times\mathbf{a}_y=\mathbf{a}_z$ can define right-handed orientation.

## Related Pages

- [[differential-elements-in-rectangular-coordinates|Differential Elements in Rectangular Coordinates]]
- [[rectangular-vector-components-and-unit-vectors|Rectangular Vector Components and Unit Vectors]]
- [[displacement-vectors-between-points|Displacement Vectors Between Points]]
- [[cross-product-orientation-and-magnitude|Cross Product Orientation and Magnitude]]

## Concept Dependencies

- enables: [[rectangular-vector-components-and-unit-vectors|Rectangular Vector Components and Unit Vectors]]
- enables: [[differential-elements-in-rectangular-coordinates|Differential Elements in Rectangular Coordinates]]
- related: [[cross-product-orientation-and-magnitude|Cross Product Orientation and Magnitude]]
