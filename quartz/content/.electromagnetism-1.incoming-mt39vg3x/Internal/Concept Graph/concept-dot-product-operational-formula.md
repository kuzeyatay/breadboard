---
title: "Dot Product Operational Formula"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "dot-product-operational-formula"
locations: ["Page 21", "Page 22", "Page 23"]
related: ["rectangular-vector-components-and-unit-vectors", "dot-product-as-scalar-projection", "directional-projection-worked-procedure", "vector-magnitude-and-normalization"]
---

## ConceptNode: Dot Product Operational Formula

Planning node for [[dot-product-operational-formula|1.14 Dot Product Operational Formula]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 21, Page 22, Page 23

In rectangular coordinates, the dot product can be calculated without first finding the angle between vectors. For $$\mathbf{A}=A_x\mathbf{a}_x+A_y\mathbf{a}_y+A_z\mathbf{a}_z$$ and $$\mathbf{B}=B_x\mathbf{a}_x+B_y\mathbf{a}_y+B_z\mathbf{a}_z,$$ distributivity initially produces nine terms. Dot products between different rectangular basis vectors vanish because those vectors are perpendicular, while each basis vector dotted with itself equals one. The surviving terms give $$\mathbf{A}\cdot\mathbf{B}=A_xB_x+A_yB_y+A_zB_z.$$ This is Equation (5), the operational definition used for calculation. A vector dotted with itself gives its squared magnitude: $$\mathbf{A}\cdot\mathbf{A}=|\mathbf{A}|^2.$$ A unit vector therefore satisfies $\mathbf{a}_A\cdot\mathbf{a}_A=1$. The operational and geometric definitions can be combined to calculate the angle between vectors by dividing the dot product by the product of their magnitudes and applying the inverse cosine.

### Key planning details

- Different rectangular basis vectors have zero dot product.
- Each rectangular unit vector dotted with itself equals one.
- The component formula is $A_xB_x+A_yB_y+A_zB_z$.
- The component formula avoids direct three-dimensional angle construction.
- A vector dotted with itself equals its squared magnitude.
- A unit vector dotted with itself equals one.
- The geometric and operational definitions together determine vector angles.

### Source coverage

- The source lists all mixed products such as $\mathbf{a}_x\cdot\mathbf{a}_y$ as zero.
- Equation (5) gives $\mathbf{A}\cdot\mathbf{B}=A_xB_x+A_yB_y+A_zB_z$.
- Equation (6) gives $\mathbf{A}\cdot\mathbf{A}=|\mathbf{A}|^2$.
- The source states $\mathbf{a}_A\cdot\mathbf{a}_A=1$.
- Example 1.2 uses the dot product and magnitude to calculate an angle of $99.9^\circ$.
