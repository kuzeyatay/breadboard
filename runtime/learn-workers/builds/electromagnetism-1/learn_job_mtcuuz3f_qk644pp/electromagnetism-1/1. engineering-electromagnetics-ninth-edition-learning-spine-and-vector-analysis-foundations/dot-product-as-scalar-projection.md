---
title: "1.13 Dot Product as Scalar Projection"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 20", "Page 21", "Page 22"]
related: ["vector-magnitude-and-normalization", "dot-product-operational-formula", "dot-product-applications-to-work-and-flux", "directional-projection-worked-procedure"]
source_images: ["/electromagnetism-1/assets/engineering-electromagnetics-9th-ed-9nbsped-compress-page-020.png", "/electromagnetism-1/assets/engineering-electromagnetics-9th-ed-9nbsped-compress-page-021.png"]
---

# 1.13 Dot Product as Scalar Projection

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 20, Page 21, Page 22

The dot product measures how strongly one vector lies along another direction. Geometrically, for vectors $\mathbf{A}$ and $\mathbf{B}$ separated by the smaller angle $\theta_{AB}$,
$$
\mathbf{A}\cdot\mathbf{B}=|\mathbf{A}||\mathbf{B}|\cos\theta_{AB}
$$
 The result is a scalar. Because cosine is unchanged when the vector order is reversed, the dot product is commutative: $\mathbf{A}\cdot\mathbf{B}=\mathbf{B}\cdot\mathbf{A}$. When the second vector is a unit vector $\mathbf{a}$,
$$
\mathbf{B}\cdot\mathbf{a}=|\mathbf{B}|\cos\theta_{Ba}
$$
 is the signed scalar component of $\mathbf{B}$ in the $\mathbf{a}$ direction. It is positive for an acute or right angle range up to $90^\circ$ and negative for angles from $90^\circ$ to $180^\circ$. Multiplying this scalar by the direction vector gives the vector projection:
$$
(\mathbf{B}\cdot\mathbf{a})\mathbf{a}
$$
 Figure 1.4 distinguishes the scalar component from the vector component.

## Source Figures and Snapshots

![engineering-electromagnetics-9th-ed-9nbsped_compress Page 20](/electromagnetism-1/assets/engineering-electromagnetics-9th-ed-9nbsped-compress-page-020.png)

![engineering-electromagnetics-9th-ed-9nbsped_compress Page 21](/electromagnetism-1/assets/engineering-electromagnetics-9th-ed-9nbsped-compress-page-021.png)

## Page-Grounded Details

#### Page 20

#### 1.5 THE VECTOR FIELD

We have defined a vector field as a vector function of a position vector. In general, the magnitude and direction of the function will change as we move throughout the region, and the value of the vector function must be determined using the coordinate values of the point in question. In the rectangular coordinate system, the vector will be a function of the variables $x$, $y$, and $z$.

Again, representing the position vector as $\mathbf{r}$, a vector field $\mathbf{G}$ can be expressed in functional notation as $\mathbf{G}(\mathbf{r})$; a scalar field $T$ is written as $T(\mathbf{r})$.

If we inspect the velocity of the water in the ocean in some region near the surface where tides and currents are important, we might decide to represent it by a velocity vector that is in any direction, even up or down. If the $z$ axis is taken as upward, the $x$ axis in a northerly direction, the $y$ axis to the west, and the origin at the surface, we have a right-handed coordinate system and may write the velocity vector as $\mathbf{v}=v_{x}\mathbf{a}_{x}+v_{y}\mathbf{a}_{y}+v_{z}\mathbf{a}_{z}$, or $ \mathbf{v}(\mathbf{r})=v_{x}(\mathbf{r})\ma

[Truncated for analysis]

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

## Core Ideas

- The dot product returns a scalar.
- Its magnitude depends on the cosine of the included angle.
- The dot product is commutative.
- Dotting with a unit vector gives a signed scalar component.
- A negative projection indicates a component opposite the chosen direction.
- Multiplying the scalar projection by the unit vector gives the vector projection.
- Projection requires a correctly normalized direction vector.

## Source Anchors

- Equation (3) gives $\mathbf{A}\cdot\mathbf{B}=|\mathbf{A}||\mathbf{B}|\cos\theta_{AB}$.
- Equation (4) states $\mathbf{A}\cdot\mathbf{B}=\mathbf{B}\cdot\mathbf{A}$.
- Figure 1.4(a) shows the scalar component $\mathbf{B}\cdot\mathbf{a}$.
- Figure 1.4(b) shows the vector component $(\mathbf{B}\cdot\mathbf{a})\mathbf{a}$.
- The source identifies $\mathbf{B}\cdot\mathbf{a}$ as the projection of $\mathbf{B}$ in the $\mathbf{a}$ direction.

## Related Pages

- [[vector-magnitude-and-normalization|Vector Magnitude and Normalization]]
- [[dot-product-operational-formula|Dot Product Operational Formula]]
- [[dot-product-applications-to-work-and-flux|Dot Product Applications to Work and Flux]]
- [[directional-projection-worked-procedure|Directional Projection Worked Procedure]]

## Concept Dependencies

- related: [[dot-product-operational-formula|Dot Product Operational Formula]]
- applies-to: [[directional-projection-worked-procedure|Directional Projection Worked Procedure]]
- applies-to: [[dot-product-applications-to-work-and-flux|Dot Product Applications to Work and Flux]]
