---
title: "1.17 Cross Product Orientation and Magnitude"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 23", "Page 24"]
related: ["right-handed-rectangular-coordinates", "vector-magnitude-and-normalization", "vector-algebra", "rectangular-vector-components-and-unit-vectors", "dot-product-as-scalar-projection"]
source_images: ["/electromagnetism-1/assets/engineering-electromagnetics-9th-ed-9nbsped-compress-page-023.png", "/electromagnetism-1/assets/engineering-electromagnetics-9th-ed-9nbsped-compress-page-024.png"]
---

# 1.17 Cross Product Orientation and Magnitude

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 23, Page 24

The cross product combines the component of one vector perpendicular to another with a direction normal to both. For vectors $\mathbf{A}$ and $\mathbf{B}$,
$$
\mathbf{A}\times\mathbf{B}=\mathbf{a}_N|\mathbf{A}||\mathbf{B}|\sin\theta_{AB}
$$
 where $\mathbf{a}_N$ is normal to the plane containing the vectors. Its direction follows the right-handed screw rule as $\mathbf{A}$ rotates toward $\mathbf{B}$. Reversing the order reverses the direction, so
$$
\mathbf{B}\times\mathbf{A}=-(\mathbf{A}\times\mathbf{B})
$$
 The cross product is therefore not commutative. In a right-handed rectangular basis, $\mathbf{a}_x\times\mathbf{a}_y=\mathbf{a}_z$, $\mathbf{a}_y\times\mathbf{a}_z=\mathbf{a}_x$, and $\mathbf{a}_z\times\mathbf{a}_x=\mathbf{a}_y$. The magnitude $|\mathbf{A}\times\mathbf{B}|$ equals the area of the parallelogram formed by the two vectors. Figure 1.5 supplies the source-central orientation diagram.

## Source Figures and Snapshots

![engineering-electromagnetics-9th-ed-9nbsped_compress Page 23](/electromagnetism-1/assets/engineering-electromagnetics-9th-ed-9nbsped-compress-page-023.png)

![engineering-electromagnetics-9th-ed-9nbsped_compress Page 24](/electromagnetism-1/assets/engineering-electromagnetics-9th-ed-9nbsped-compress-page-024.png)

## Page-Grounded Details

#### Page 23

Next we find the scalar component. Using the dot product, we have
$$
\mathbf{G}\cdot\mathbf{a}_{N}=(5\mathbf{a}_{x}-10\mathbf{a}_{y}+3\mathbf{a}_{z})\cdot\frac{1}{3}\left(2\mathbf{a}_{x}+\mathbf{a}_{y}-2\mathbf{a}_{z}\right)=\frac{1}{3}\left(10-10-6\right)=-2
$$
 The vector component is obtained by multiplying the scalar component by the unit vector in the direction of $\mathbf{a}_{N}$,
$$
(\mathbf{G}\cdot\mathbf{a}_{N})\mathbf{a}_{N}=-(2)\,\frac{1}{3}\left(2\mathbf{a}_{x}+\mathbf{a}_{y}-2\mathbf{a}_{z}\right)=-1.333\,\mathbf{a}_{x}-0.667\,\mathbf{a}_{y}+1.333\,\mathbf{a}_{z}
$$
The angle between $\mathbf{G(r_{Q})}$ and $\mathbf{a}_{N}$ is found from
$$
\begin{align*}\mathbf{G}\cdot\mathbf{a}_{N}=&\,|\mathbf{G}|\cos\theta_{Ga}\\ &-2=\sqrt{25+100+9}\cos\theta_{Ga}\end{align*}
$$
 and
$$
\theta_{Ga}=\cos^{-1}\frac{-2}{\sqrt{134}}=99.9^{\circ}
$$
D1.3. The three vertices of a triangle are located at A(6,-1,2), B(-2,3,-4), and C(-3,1,5). Find: (a) $\mathbf{R}_{AB}$; (b) $\mathbf{R}_{AC}$; (c) the angle $\theta_{BAC}$ at vertex A; (d) the (vector) projection of $\mathbf{R}_{AB}$ on $\mathbf{R}_{AC}$.

Ans. (a) $-8\mathbf{a}_{x}+4\mathbf{a}_{y}-6\mathbf{a}_{z}$;

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

- The cross product returns a vector.
- Its magnitude is $|\mathbf{A}||\mathbf{B}|\sin\theta_{AB}$.
- Its direction is normal to the plane of the input vectors.
- The right-handed screw rule determines the normal's sign.
- Reversing the operand order reverses the result.
- Cyclic rectangular basis products are positive.
- The cross-product magnitude equals parallelogram area.

## Source Anchors

- Equation (7) gives $\mathbf{A}\times\mathbf{B}=\mathbf{a}_N|\mathbf{A}||\mathbf{B}|\sin\theta_{AB}$.
- Figure 1.5 shows the right-handed screw direction for $\mathbf{A}\times\mathbf{B}$.
- The source states $\mathbf{B}\times\mathbf{A}=-(\mathbf{A}\times\mathbf{B})$.
- The basis products include $\mathbf{a}_x\times\mathbf{a}_y=\mathbf{a}_z$.
- The source identifies $|\mathbf{A}\times\mathbf{B}|$ as the area of a parallelogram with adjacent sides $\mathbf{A}$ and $\mathbf{B}$.
- The section states that cross products describe many physical phenomena in electromagnetics.

## Related Pages

- [[right-handed-rectangular-coordinates|Right-Handed Rectangular Coordinates]]
- [[vector-magnitude-and-normalization|Vector Magnitude and Normalization]]
- [[vector-algebra|Vector Algebra]]
- [[rectangular-vector-components-and-unit-vectors|Rectangular Vector Components and Unit Vectors]]
- [[dot-product-as-scalar-projection|Dot Product as Scalar Projection]]

## Concept Dependencies

- depends-on: [[right-handed-rectangular-coordinates|Right-Handed Rectangular Coordinates]]
- depends-on: [[vector-magnitude-and-normalization|Vector Magnitude and Normalization]]
- contrasts-with: [[dot-product-as-scalar-projection|Dot Product as Scalar Projection]]
