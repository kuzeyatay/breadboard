---
title: "Directional Projection Worked Procedure"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "directional-projection-worked-procedure"
locations: ["Page 22", "Page 23"]
related: ["evaluating-position-dependent-vector-fields", "dot-product-as-scalar-projection", "dot-product-operational-formula", "vector-magnitude-and-normalization"]
---

## ConceptNode: Directional Projection Worked Procedure

Planning node for [[directional-projection-worked-procedure|1.16 Directional Projection Worked Procedure]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 22, Page 23

Example 1.2 provides a reusable procedure for evaluating a field and extracting its component in a specified direction. The field is $$\mathbf{G}=y\mathbf{a}_x-2.5x\mathbf{a}_y+3\mathbf{a}_z,$$ and the evaluation point is $Q(4,5,2)$. Substitution gives $$\mathbf{G}(\mathbf{r}_Q)=5\mathbf{a}_x-10\mathbf{a}_y+3\mathbf{a}_z.$$ The specified unit direction is $$\mathbf{a}_N=\frac{1}{3}(2\mathbf{a}_x+\mathbf{a}_y-2\mathbf{a}_z).$$ The scalar projection is found using the dot product and equals $-2$. Multiplying by $\mathbf{a}_N$ gives the vector projection $$-1.333\mathbf{a}_x-0.667\mathbf{a}_y+1.333\mathbf{a}_z.$$ Finally, combining $\mathbf{G}\cdot\mathbf{a}_N=|\mathbf{G}|\cos\theta$ with $|\mathbf{G}|=\sqrt{134}$ gives $\theta=99.9^\circ$. The negative scalar component is consistent with an obtuse angle between the vectors.

### Key planning details

- Evaluate the vector field at the specified point first.
- Verify or construct a unit vector in the requested direction.
- Dot the evaluated field with the unit direction to obtain the scalar component.
- Multiply the scalar component by the unit direction to obtain the vector component.
- Use the geometric dot-product formula to calculate the angle.
- A negative scalar projection corresponds to an obtuse angle in this example.
- The procedure applies to arbitrary rectangular-coordinate directions.

### Source coverage

- The evaluated field is $5\mathbf{a}_x-10\mathbf{a}_y+3\mathbf{a}_z$.
- The direction is $\mathbf{a}_N=(2\mathbf{a}_x+\mathbf{a}_y-2\mathbf{a}_z)/3$.
- The scalar component is $-2$.
- The vector component is $-1.333\mathbf{a}_x-0.667\mathbf{a}_y+1.333\mathbf{a}_z$.
- The calculated angle is $99.9^\circ$.
- D1.3 applies the same ideas to a triangle and asks for an angle and vector projection.
