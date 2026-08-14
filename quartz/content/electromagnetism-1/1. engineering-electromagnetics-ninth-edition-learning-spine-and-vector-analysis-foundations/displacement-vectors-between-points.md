---
title: "1.10 Displacement Vectors Between Points"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 17", "Page 18", "Page 19"]
related: ["vector-algebra", "rectangular-vector-components-and-unit-vectors", "vector-magnitude-and-normalization", "dot-product-as-scalar-projection"]
source_images: ["/electromagnetism-1/assets/engineering-electromagnetics-9th-ed-9nbsped-compress-page-017.png", "/electromagnetism-1/assets/engineering-electromagnetics-9th-ed-9nbsped-compress-page-018.png"]
---

# 1.10 Displacement Vectors Between Points

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 17, Page 18, Page 19

The vector from one point to another is found by subtracting the initial point's position vector from the final point's position vector. For $P(1,2,3)$ and $Q(2,-2,1)$, the position vectors are $\mathbf{r}_P=\mathbf{a}_x+2\mathbf{a}_y+3\mathbf{a}_z$ and $\mathbf{r}_Q=2\mathbf{a}_x-2\mathbf{a}_y+\mathbf{a}_z$. Since traveling from the origin to $P$ and then from $P$ to $Q$ must equal traveling directly from the origin to $Q$,
$$
\mathbf{r}_P+\mathbf{R}_{PQ}=\mathbf{r}_Q
$$
 Solving gives
$$
\mathbf{R}_{PQ}=\mathbf{r}_Q-\mathbf{r}_P=\mathbf{a}_x-4\mathbf{a}_y-2\mathbf{a}_z
$$
 This componentwise subtraction procedure is reusable for constructing line directions, distances, projections, and geometric angles. Drill problem D1.1 extends it to points $M$, $N$, and $P$, requiring displacement vectors, vector sums, magnitudes, normalized directions, and linear combinations of position vectors.

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

- A position vector extends from the origin to a point.
- The vector from $P$ to $Q$ is $\mathbf{R}_{PQ}=\mathbf{r}_Q-\mathbf{r}_P$.
- Final coordinates minus initial coordinates determine each component.
- The sign of each component records the required coordinate-direction change.
- The construction follows directly from vector addition.
- Displacement vectors can be normalized to obtain line directions.
- The same method extends to triangle sides and geometric projections.

## Source Anchors

- The source uses $P(1,2,3)$ and $Q(2,-2,1)$.
- The worked subtraction is
$$
(2-1)\mathbf{a}_x+(-2-2)\mathbf{a}_y+(1-3)\mathbf{a}_z
$$
- The result is $\mathbf{R}_{PQ}=\mathbf{a}_x-4\mathbf{a}_y-2\mathbf{a}_z$.
- Figure 1.3(c) shows $\mathbf{r}_P$, $\mathbf{r}_Q$, and $\mathbf{R}_{PQ}$.
- D1.1 asks for $\mathbf{R}_{MN}$, $\mathbf{R}_{MN}+\mathbf{R}_{MP}$, $|\mathbf{r}_M|$, $\mathbf{a}_{MP}$, and $|2\mathbf{r}_P-3\mathbf{r}_N|$.

## Related Pages

- [[vector-algebra|Vector Algebra]]
- [[rectangular-vector-components-and-unit-vectors|Rectangular Vector Components and Unit Vectors]]
- [[vector-magnitude-and-normalization|Vector Magnitude and Normalization]]
- [[dot-product-as-scalar-projection|Dot Product as Scalar Projection]]

## Concept Dependencies

- applies-to: [[vector-algebra|Vector Algebra]]
- enables: [[vector-magnitude-and-normalization|Vector Magnitude and Normalization]]
