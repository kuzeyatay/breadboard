---
title: "1.11 Vector Magnitude and Normalization"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 19"]
related: ["rectangular-vector-components-and-unit-vectors", "displacement-vectors-between-points", "dot-product-as-scalar-projection", "cross-product-orientation-and-magnitude"]
source_images: ["/electromagnetism-1/assets/engineering-electromagnetics-9th-ed-9nbsped-compress-page-019.png"]
---

# 1.11 Vector Magnitude and Normalization

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 19

The magnitude of a rectangular vector follows from the three-dimensional Pythagorean relation. For
$$
\mathbf{B}=B_x\mathbf{a}_x+B_y\mathbf{a}_y+B_z\mathbf{a}_z
$$
 its magnitude is
$$
|\mathbf{B}|=\sqrt{B_x^2+B_y^2+B_z^2}
$$
 A unit vector in the direction of any nonzero vector is obtained by dividing that vector by its magnitude:
$$
\mathbf{a}_B=\frac{\mathbf{B}}{|\mathbf{B}|}
$$
 Example 1.1 applies this procedure to the point $G(2,-2,-1)$. The vector from the origin is $\mathbf{G}=2\mathbf{a}_x-2\mathbf{a}_y-\mathbf{a}_z$, and its magnitude is $3$. Dividing each component by $3$ gives
$$
\mathbf{a}_G=\frac{2}{3}\mathbf{a}_x-\frac{2}{3}\mathbf{a}_y-\frac{1}{3}\mathbf{a}_z
$$
 Normalization preserves direction while scaling the magnitude to one. It is essential when a calculation requires direction alone, especially in projections, surface normals, and cross-product descriptions.

## Source Figures and Snapshots

![engineering-electromagnetics-9th-ed-9nbsped_compress Page 19](/electromagnetism-1/assets/engineering-electromagnetics-9th-ed-9nbsped-compress-page-019.png)

## Page-Grounded Details

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

- Magnitude is the square root of the sum of squared rectangular components.
- Normalization divides a nonzero vector by its magnitude.
- A normalized vector has magnitude one.
- Normalization preserves the original direction.
- Signed components remain signed after normalization.
- The notation $\mathbf{a}_B$ identifies a unit vector in the direction of $\mathbf{B}$.
- Unit directions are prerequisites for scalar and vector projections.

## Source Anchors

- Equation (1) gives $|\mathbf{B}|=\sqrt{B_x^2+B_y^2+B_z^2}$.
- Equation (2) gives $\mathbf{a}_B=\mathbf{B}/|\mathbf{B}|$.
- Example 1.1 constructs $\mathbf{G}=2\mathbf{a}_x-2\mathbf{a}_y-\mathbf{a}_z$.
- The example calculates $|\mathbf{G}|=3$.
- The normalized result is approximately $0.667\mathbf{a}_x-0.667\mathbf{a}_y-0.333\mathbf{a}_z$.

## Related Pages

- [[rectangular-vector-components-and-unit-vectors|Rectangular Vector Components and Unit Vectors]]
- [[displacement-vectors-between-points|Displacement Vectors Between Points]]
- [[dot-product-as-scalar-projection|Dot Product as Scalar Projection]]
- [[cross-product-orientation-and-magnitude|Cross Product Orientation and Magnitude]]

## Concept Dependencies

- enables: [[dot-product-as-scalar-projection|Dot Product as Scalar Projection]]
- enables: [[cross-product-orientation-and-magnitude|Cross Product Orientation and Magnitude]]
