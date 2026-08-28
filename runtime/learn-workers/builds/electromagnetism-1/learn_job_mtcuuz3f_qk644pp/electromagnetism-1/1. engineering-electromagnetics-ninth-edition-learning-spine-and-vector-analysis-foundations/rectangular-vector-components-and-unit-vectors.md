---
title: "1.9 Rectangular Vector Components and Unit Vectors"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 17", "Page 18", "Page 19"]
related: ["right-handed-rectangular-coordinates", "vector-algebra", "displacement-vectors-between-points", "vector-magnitude-and-normalization", "dot-product-operational-formula"]
source_images: ["/electromagnetism-1/assets/engineering-electromagnetics-9th-ed-9nbsped-compress-page-017.png", "/electromagnetism-1/assets/engineering-electromagnetics-9th-ed-9nbsped-compress-page-018.png"]
---

# 1.9 Rectangular Vector Components and Unit Vectors

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 17, Page 18, Page 19

Any vector in rectangular coordinates can be decomposed into components along three mutually perpendicular basis directions. The basis vectors $\mathbf{a}_x$, $\mathbf{a}_y$, and $\mathbf{a}_z$ each have unit magnitude and point toward increasing values of their respective coordinates. A general vector is therefore written
$$
\mathbf{B}=B_x\mathbf{a}_x+B_y\mathbf{a}_y+B_z\mathbf{a}_z
$$
 where $B_x$, $B_y$, and $B_z$ are signed scalar components. The corresponding component vectors are $B_x\mathbf{a}_x$, $B_y\mathbf{a}_y$, and $B_z\mathbf{a}_z$. Figure 1.3 distinguishes component vectors from unit basis vectors and shows how they reconstruct a vector. Because vectors are determined by magnitude and direction rather than absolute drawing location, a vector may be translated parallel to itself to the origin for decomposition. This translation must preserve orientation. The component representation makes vector addition, subtraction, magnitude calculation, field evaluation, and vector products operationally manageable.

## Source Figures and Snapshots

![engineering-electromagnetics-9th-ed-9nbsped_compress Page 17](/electromagnetism-1/assets/engineering-electromagnetics-9th-ed-9nbsped-compress-page-017.png)

![engineering-electromagnetics-9th-ed-9nbsped_compress Page 18](/electromagnetism-1/assets/engineering-electromagnetics-9th-ed-9nbsped-compress-page-018.png)

## Page-Grounded Details

#### Page 17

planes $x=1$ , $y=2$ , and $z=3$ , whereas point Q is located at the intersection of the planes $x=2$ , $y=-2$ , and $z=1$ .

In other coordinate systems, as discussed in Sections 1.8 and 1.9, we expect points to be located at the common intersection of three surfaces, not necessarily planes, but still mutually perpendicular at the point of intersection.

If we visualize three planes intersecting at the general point P, whose coordinates are x,y,and z, we may increase each coordinate value by a differential amount and obtain three slightly displaced planes intersecting at point $P^{\prime}$ , whose coordinates are$x+dx,y+dy$ , and $z+dz$ . The six planes define a rectangular parallelepiped whose volume is $dv=dxdydz$ ; the surfaces have differential areas dS of $dxdy$ , $dydz$ , and$dzdx$ . Finally, the distance $dL$ from P to $P^{\prime}$ is the diagonal of the parallelepiped and has a length of $\sqrt{(dx)^{2}+(dy)^{2}+(dz)^{2}}$ . The volume element is shown in Figure 1.2c;point $P^{\prime}$ is indicated, but point P is located at the only invisible corner.

All this is familiar from trigonometry or solid geometry and as yet involves only scalar

[Truncated for analysis]

#### Page 18

Figure 1.3 (a) The component vectors $\mathbf{x}, \mathbf{y}$, and $\mathbf{z}$ of vector $\mathbf{r}$. (b) The unit vectors of the rectangular coordinate system have unit magnitude and are directed toward increasing values of their respective variables. (c) The vector $\mathbf{R}_{PQ}$ is equal to the vector difference $\mathbf{r}_Q - \mathbf{r}_P$.

The last vector does not extend outward from the origin, as did the vector $\mathbf{r}$ we initially considered. However, we have already learned that vectors having the same magnitude and pointing in the same direction are equal, so we see that to help our visualization processes we are at liberty to slide any vector over to the origin before determining its component vectors. Parallelism must, of course, be maintained during the sliding process.

In discussing a force vector $\mathbf{F}$, or any vector other than a displacement-type vector such as $\mathbf{r}$, the problem arises of providing suitable letters for the three component vectors. It would not do to call them $\mathbf{x}$, $\mathbf{y}$, and $\mathbf{z}$, for these are displacements, or directed distances, and are measured in meters (abbreviated m) or some other unit of le

[Truncated for analysis]

#### Page 19

Any vector B then may be described by $B=B_{x}a_{x}+B_{y}a_{y}+B_{z}a_{z}$. The magnitude of B written |B| or simply B, is given by
$$
|B|=\sqrt{B_{x}^{2}+B_{y}^{2}+B_{z}^{2}}\qquad(1)
$$
 Each of the three coordinate systems we discuss will have its three fundamental and mutually perpendicular unit vectors that are used to resolve any vector into its component vectors. Unit vectors are not limited to this application. It is helpful to write a unit vector having a specified direction. This is easily done, for a unit vector in a given direction is merely a vector in that direction divided by its magnitude. A unit vector in the r direction is $r/\sqrt{x^{2}+y^{2}+z^{2}}$, and a unit vector in the direction of the vector B is
$$
a_{B}=\frac{B}{\sqrt{B_{x}^{2}+B_{y}^{2}+B_{z}^{2}}}=\frac{B}{|B|}\qquad(2)
$$
<category>

#### Example 1.1

Specify the unit vector extending from the origin toward the point G(2,-2,-1).

Solution. We first construct the vector extending from the origin to point G,
$$
G=2a_{x}-2a_{y}-a_{z}
$$
<category>

We continue by finding the magnitude of G,
$$
|G|=\sqrt{(2)^{2}+(-2)^{2}+(-1)^{2}}=3
$$
<category>

and finally expressing the desired unit vector as t

[Truncated for analysis]

## Core Ideas

- The rectangular basis consists of $\mathbf{a}_x$, $\mathbf{a}_y$, and $\mathbf{a}_z$.
- Each basis vector has unit magnitude.
- Each basis vector points toward increasing coordinate values.
- Scalar components are signed magnitudes of component vectors.
- A vector is reconstructed by summing its three component vectors.
- A vector may be translated parallel to itself without changing the vector.
- Parallelism must be maintained when sliding a vector.

## Source Anchors

- Figure 1.3(a) shows the component vectors of $\mathbf{r}$.
- Figure 1.3(b) shows the rectangular unit vectors.
- The text writes $\mathbf{F}=F_x\mathbf{a}_x+F_y\mathbf{a}_y+F_z\mathbf{a}_z$.
- The component vectors are identified as $F_x\mathbf{a}_x$, $F_y\mathbf{a}_y$, and $F_z\mathbf{a}_z$.
- Figure 1.3(c) shows $\mathbf{R}_{PQ}=\mathbf{r}_Q-\mathbf{r}_P$.

## Related Pages

- [[right-handed-rectangular-coordinates|Right-Handed Rectangular Coordinates]]
- [[vector-algebra|Vector Algebra]]
- [[displacement-vectors-between-points|Displacement Vectors Between Points]]
- [[vector-magnitude-and-normalization|Vector Magnitude and Normalization]]
- [[dot-product-operational-formula|Dot Product Operational Formula]]

## Concept Dependencies

- enables: [[displacement-vectors-between-points|Displacement Vectors Between Points]]
- enables: [[vector-magnitude-and-normalization|Vector Magnitude and Normalization]]
- enables: [[dot-product-operational-formula|Dot Product Operational Formula]]
