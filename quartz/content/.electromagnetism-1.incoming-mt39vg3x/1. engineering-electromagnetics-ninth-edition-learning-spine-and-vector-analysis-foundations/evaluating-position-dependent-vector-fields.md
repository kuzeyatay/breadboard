---
title: "1.12 Evaluating Position-Dependent Vector Fields"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 20"]
related: ["scalar-and-vector-fields", "rectangular-vector-components-and-unit-vectors", "vector-magnitude-and-normalization", "dot-product-as-scalar-projection", "directional-projection-worked-procedure"]
source_images: ["/electromagnetism-1/assets/engineering-electromagnetics-9th-ed-9nbsped-compress-page-020.png"]
---

# 1.12 Evaluating Position-Dependent Vector Fields

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 20

A vector field in rectangular coordinates is evaluated by substituting a point's coordinate values into each component function. In general,
$$
\mathbf{v}(\mathbf{r})=v_x(\mathbf{r})\mathbf{a}_x+v_y(\mathbf{r})\mathbf{a}_y+v_z(\mathbf{r})\mathbf{a}_z
$$
 and each component may depend on $x$, $y$, and $z$. The ocean-current example chooses $z$ upward, $x$ northward, and $y$ westward, producing a right-handed frame. In a simplified region where flow is only northward and decreases with depth, the field is
$$
\mathbf{v}=2e^{z/100}\mathbf{a}_x
$$
 At the surface, where $z=0$, the speed is $2$ m/s. At a depth of $100$ m, where $z=-100$, the speed is $2e^{-1}=0.736$ m/s. Direction remains fixed along $\mathbf{a}_x$ while magnitude decreases with depth. Drill problem D1.2 generalizes field evaluation by asking for a field value, its unit direction, and a constant-magnitude surface.

## Source Figures and Snapshots

![engineering-electromagnetics-9th-ed-9nbsped_compress Page 20](/electromagnetism-1/assets/engineering-electromagnetics-9th-ed-9nbsped-compress-page-020.png)

## Page-Grounded Details

#### Page 20

#### 1.5 THE VECTOR FIELD

We have defined a vector field as a vector function of a position vector. In general, the magnitude and direction of the function will change as we move throughout the region, and the value of the vector function must be determined using the coordinate values of the point in question. In the rectangular coordinate system, the vector will be a function of the variables $x$, $y$, and $z$.

Again, representing the position vector as $\mathbf{r}$, a vector field $\mathbf{G}$ can be expressed in functional notation as $\mathbf{G}(\mathbf{r})$; a scalar field $T$ is written as $T(\mathbf{r})$.

If we inspect the velocity of the water in the ocean in some region near the surface where tides and currents are important, we might decide to represent it by a velocity vector that is in any direction, even up or down. If the $z$ axis is taken as upward, the $x$ axis in a northerly direction, the $y$ axis to the west, and the origin at the surface, we have a right-handed coordinate system and may write the velocity vector as $\mathbf{v}=v_{x}\mathbf{a}_{x}+v_{y}\mathbf{a}_{y}+v_{z}\mathbf{a}_{z}$, or $ \mathbf{v}(\mathbf{r})=v_{x}(\mathbf{r})\ma

[Truncated for analysis]

## Core Ideas

- Each field component can be a function of position.
- Field evaluation substitutes a point's coordinates into all component functions.
- Some components may be identically zero under physical assumptions.
- A field can vary in magnitude while retaining constant direction.
- The field $2e^{z/100}\mathbf{a}_x$ decreases with increasing depth.
- At $z=0$, the example field has magnitude $2$ m/s.
- At $z=-100$ m, its magnitude is $0.736$ m/s.

## Source Anchors

- The general field notation is $\mathbf{v}(\mathbf{r})=v_x(\mathbf{r})\mathbf{a}_x+v_y(\mathbf{r})\mathbf{a}_y+v_z(\mathbf{r})\mathbf{a}_z$.
- The ocean-current coordinates use $z$ upward, $x$ northward, and $y$ westward.
- The simplified current is $\mathbf{v}=2e^{z/100}\mathbf{a}_x$.
- The source evaluates the field as $2$ m/s at the surface and $0.736$ m/s at $100$ m depth.
- D1.2 asks for a field value at $P(2,4,3)$, a unit direction, and the surface on which the magnitude equals one.

## Related Pages

- [[scalar-and-vector-fields|Scalar and Vector Fields]]
- [[rectangular-vector-components-and-unit-vectors|Rectangular Vector Components and Unit Vectors]]
- [[vector-magnitude-and-normalization|Vector Magnitude and Normalization]]
- [[dot-product-as-scalar-projection|Dot Product as Scalar Projection]]
- [[directional-projection-worked-procedure|Directional Projection Worked Procedure]]

## Concept Dependencies

- applies-to: [[scalar-and-vector-fields|Scalar and Vector Fields]]
- enables: [[directional-projection-worked-procedure|Directional Projection Worked Procedure]]
