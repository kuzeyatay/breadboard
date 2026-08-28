---
title: "1.16 Directional Projection Worked Procedure"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 22", "Page 23"]
related: ["evaluating-position-dependent-vector-fields", "dot-product-as-scalar-projection", "dot-product-operational-formula", "vector-magnitude-and-normalization"]
source_images: ["/electromagnetism-1/assets/engineering-electromagnetics-9th-ed-9nbsped-compress-page-022.png", "/electromagnetism-1/assets/engineering-electromagnetics-9th-ed-9nbsped-compress-page-023.png"]
---

# 1.16 Directional Projection Worked Procedure

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 22, Page 23

Example 1.2 provides a reusable procedure for evaluating a field and extracting its component in a specified direction. The field is
$$
\mathbf{G}=y\mathbf{a}_x-2.5x\mathbf{a}_y+3\mathbf{a}_z
$$
 and the evaluation point is $Q(4,5,2)$. Substitution gives
$$
\mathbf{G}(\mathbf{r}_Q)=5\mathbf{a}_x-10\mathbf{a}_y+3\mathbf{a}_z
$$
 The specified unit direction is
$$
\mathbf{a}_N=\frac{1}{3}(2\mathbf{a}_x+\mathbf{a}_y-2\mathbf{a}_z)
$$
 The scalar projection is found using the dot product and equals $-2$. Multiplying by $\mathbf{a}_N$ gives the vector projection
$$
-1.333\mathbf{a}_x-0.667\mathbf{a}_y+1.333\mathbf{a}_z
$$
 Finally, combining $\mathbf{G}\cdot\mathbf{a}_N=|\mathbf{G}|\cos\theta$ with $|\mathbf{G}|=\sqrt{134}$ gives $\theta=99.9^\circ$. The negative scalar component is consistent with an obtuse angle between the vectors.

## Source Figures and Snapshots

![engineering-electromagnetics-9th-ed-9nbsped_compress Page 22](/electromagnetism-1/assets/engineering-electromagnetics-9th-ed-9nbsped-compress-page-022.png)

![engineering-electromagnetics-9th-ed-9nbsped_compress Page 23](/electromagnetism-1/assets/engineering-electromagnetics-9th-ed-9nbsped-compress-page-023.png)

## Page-Grounded Details

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

- Evaluate the vector field at the specified point first.
- Verify or construct a unit vector in the requested direction.
- Dot the evaluated field with the unit direction to obtain the scalar component.
- Multiply the scalar component by the unit direction to obtain the vector component.
- Use the geometric dot-product formula to calculate the angle.
- A negative scalar projection corresponds to an obtuse angle in this example.
- The procedure applies to arbitrary rectangular-coordinate directions.

## Source Anchors

- The evaluated field is $5\mathbf{a}_x-10\mathbf{a}_y+3\mathbf{a}_z$.
- The direction is $\mathbf{a}_N=(2\mathbf{a}_x+\mathbf{a}_y-2\mathbf{a}_z)/3$.
- The scalar component is $-2$.
- The vector component is $-1.333\mathbf{a}_x-0.667\mathbf{a}_y+1.333\mathbf{a}_z$.
- The calculated angle is $99.9^\circ$.
- D1.3 applies the same ideas to a triangle and asks for an angle and vector projection.

## Related Pages

- [[evaluating-position-dependent-vector-fields|Evaluating Position-Dependent Vector Fields]]
- [[dot-product-as-scalar-projection|Dot Product as Scalar Projection]]
- [[dot-product-operational-formula|Dot Product Operational Formula]]
- [[vector-magnitude-and-normalization|Vector Magnitude and Normalization]]

## Concept Dependencies

- depends-on: [[evaluating-position-dependent-vector-fields|Evaluating Position-Dependent Vector Fields]]
- depends-on: [[dot-product-operational-formula|Dot Product Operational Formula]]
- example-of: [[dot-product-as-scalar-projection|Dot Product as Scalar Projection]]
