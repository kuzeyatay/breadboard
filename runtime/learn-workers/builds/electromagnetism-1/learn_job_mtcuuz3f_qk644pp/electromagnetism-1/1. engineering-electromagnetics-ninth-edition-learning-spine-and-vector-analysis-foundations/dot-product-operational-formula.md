---
title: "1.14 Dot Product Operational Formula"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 21", "Page 22", "Page 23"]
related: ["rectangular-vector-components-and-unit-vectors", "dot-product-as-scalar-projection", "directional-projection-worked-procedure", "vector-magnitude-and-normalization"]
source_images: ["/electromagnetism-1/assets/engineering-electromagnetics-9th-ed-9nbsped-compress-page-021.png", "/electromagnetism-1/assets/engineering-electromagnetics-9th-ed-9nbsped-compress-page-022.png"]
---

# 1.14 Dot Product Operational Formula

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 21, Page 22, Page 23

In rectangular coordinates, the dot product can be calculated without first finding the angle between vectors. For
$$
\mathbf{A}=A_x\mathbf{a}_x+A_y\mathbf{a}_y+A_z\mathbf{a}_z
$$
 and
$$
\mathbf{B}=B_x\mathbf{a}_x+B_y\mathbf{a}_y+B_z\mathbf{a}_z
$$
 distributivity initially produces nine terms. Dot products between different rectangular basis vectors vanish because those vectors are perpendicular, while each basis vector dotted with itself equals one. The surviving terms give
$$
\mathbf{A}\cdot\mathbf{B}=A_xB_x+A_yB_y+A_zB_z
$$
 This is Equation (5), the operational definition used for calculation. A vector dotted with itself gives its squared magnitude:
$$
\mathbf{A}\cdot\mathbf{A}=|\mathbf{A}|^2
$$
 A unit vector therefore satisfies $\mathbf{a}_A\cdot\mathbf{a}_A=1$. The operational and geometric definitions can be combined to calculate the angle between vectors by dividing the dot product by the product of their magnitudes and applying the inverse cosine.

## Source Figures and Snapshots

![engineering-electromagnetics-9th-ed-9nbsped_compress Page 21](/electromagnetism-1/assets/engineering-electromagnetics-9th-ed-9nbsped-compress-page-021.png)

![engineering-electromagnetics-9th-ed-9nbsped_compress Page 22](/electromagnetism-1/assets/engineering-electromagnetics-9th-ed-9nbsped-compress-page-022.png)

## Page-Grounded Details

#### Page 21

The dot appears between the two vectors and should be made heavy for emphasis. The dot, or scalar, product is a scalar, as one of the names implies, and it obeys the commutative law,
$$
\mathbf{A}\cdot\mathbf{B}=\mathbf{B}\cdot\mathbf{A}\qquad(4)
$$
for the sign of the angle does not affect the cosine term. The expression $\mathbf{A}\cdot\mathbf{B}$ is read "$\mathbf{A}$ dot $\mathbf{B}$."

A common application of the dot product is in mechanics, where a constant force $\mathbf{F}$ applied over a straight displacement $\mathbf{L}$ does an amount of work $FL\cos\theta$, which is more easily written $\mathbf{F}\cdot\mathbf{L}$. If the force varies along the path, integration is necessary to find the total work (as is taken up in Chapter 4), and the result becomes
$$
\text{Work}=\int\mathbf{F}\cdot d\mathbf{L}
$$
Another example occurs in magnetic fields. The total flux $\Phi$ crossing a surface of area $S$ is given by $BS$ if the magnetic flux density $B$ is perpendicular to the surface and uniform over it. We define a vector surface $\mathbf{S}$ as having area for its magnitude and having a direction normal to the surface (avoiding for the moment the prob

[Truncated for analysis]

#### Page 22

Figure 1.4 (a) The scalar component of B in the direction of the unit vector a is B*a. (b) The vector component of B in the direction of the unit vector a is (B*a)a.

A vector dotted with itself yields the magnitude squared, or
$$
A\cdot A=A^{2}=|A|^{2}\qquad(6)
$$
and any unit vector dotted with itself is unity,
$$
a_{A}\cdot a_{A}=1
$$
One of the most important applications of the dot product is that of finding the component of a vector in a given direction. Referring to Figure 1.4a, we can obtain the component (scalar) of B in the direction specified by the unit vector a as
$$
B\cdot a=|B||a|\cos\theta_{Ba}=|B|\cos\theta_{Ba}
$$
The sign of the component is positive if $0\leq\theta_{Ba}\leq 90^{\circ}$ and negative whenever $90^{\circ}\leq\theta_{Ba}\leq 180^{\circ}$.

To obtain the component vector of B in the direction of a, we multiply the component (scalar) by a, as illustrated by Figure 1.4b. For example, the component of B in the direction of $a_{x}$ is $B\cdot a_{x}=B_{x}$, and the component vector is $B_{x}a_{x}$, or $(B\cdot a_{x})a_{x}$. Hence, the problem of finding the component of a vector in any direction becomes the problem of finding a unit vect

[Truncated for analysis]

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

## Core Ideas

- Different rectangular basis vectors have zero dot product.
- Each rectangular unit vector dotted with itself equals one.
- The component formula is $A_xB_x+A_yB_y+A_zB_z$.
- The component formula avoids direct three-dimensional angle construction.
- A vector dotted with itself equals its squared magnitude.
- A unit vector dotted with itself equals one.
- The geometric and operational definitions together determine vector angles.

## Source Anchors

- The source lists all mixed products such as $\mathbf{a}_x\cdot\mathbf{a}_y$ as zero.
- Equation (5) gives $\mathbf{A}\cdot\mathbf{B}=A_xB_x+A_yB_y+A_zB_z$.
- Equation (6) gives $\mathbf{A}\cdot\mathbf{A}=|\mathbf{A}|^2$.
- The source states $\mathbf{a}_A\cdot\mathbf{a}_A=1$.
- Example 1.2 uses the dot product and magnitude to calculate an angle of $99.9^\circ$.

## Related Pages

- [[rectangular-vector-components-and-unit-vectors|Rectangular Vector Components and Unit Vectors]]
- [[dot-product-as-scalar-projection|Dot Product as Scalar Projection]]
- [[directional-projection-worked-procedure|Directional Projection Worked Procedure]]
- [[vector-magnitude-and-normalization|Vector Magnitude and Normalization]]

## Concept Dependencies

- enables: [[directional-projection-worked-procedure|Directional Projection Worked Procedure]]
- related: [[vector-magnitude-and-normalization|Vector Magnitude and Normalization]]
