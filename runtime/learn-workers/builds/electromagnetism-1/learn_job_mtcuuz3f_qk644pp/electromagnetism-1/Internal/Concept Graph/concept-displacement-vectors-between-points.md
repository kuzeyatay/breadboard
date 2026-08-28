---
title: "Displacement Vectors Between Points"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "displacement-vectors-between-points"
locations: ["Page 17", "Page 18", "Page 19"]
related: ["vector-algebra", "rectangular-vector-components-and-unit-vectors", "vector-magnitude-and-normalization", "dot-product-as-scalar-projection"]
---

## ConceptNode: Displacement Vectors Between Points

Planning node for [[displacement-vectors-between-points|1.10 Displacement Vectors Between Points]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 17, Page 18, Page 19

The vector from one point to another is found by subtracting the initial point's position vector from the final point's position vector. For $P(1,2,3)$ and $Q(2,-2,1)$, the position vectors are $\mathbf{r}_P=\mathbf{a}_x+2\mathbf{a}_y+3\mathbf{a}_z$ and $\mathbf{r}_Q=2\mathbf{a}_x-2\mathbf{a}_y+\mathbf{a}_z$. Since traveling from the origin to $P$ and then from $P$ to $Q$ must equal traveling directly from the origin to $Q$, $$\mathbf{r}_P+\mathbf{R}_{PQ}=\mathbf{r}_Q.$$ Solving gives $$\mathbf{R}_{PQ}=\mathbf{r}_Q-\mathbf{r}_P=\mathbf{a}_x-4\mathbf{a}_y-2\mathbf{a}_z.$$ This componentwise subtraction procedure is reusable for constructing line directions, distances, projections, and geometric angles. Drill problem D1.1 extends it to points $M$, $N$, and $P$, requiring displacement vectors, vector sums, magnitudes, normalized directions, and linear combinations of position vectors.

### Key planning details

- A position vector extends from the origin to a point.
- The vector from $P$ to $Q$ is $\mathbf{R}_{PQ}=\mathbf{r}_Q-\mathbf{r}_P$.
- Final coordinates minus initial coordinates determine each component.
- The sign of each component records the required coordinate-direction change.
- The construction follows directly from vector addition.
- Displacement vectors can be normalized to obtain line directions.
- The same method extends to triangle sides and geometric projections.

### Source coverage

- The source uses $P(1,2,3)$ and $Q(2,-2,1)$.
- The worked subtraction is $$(2-1)\mathbf{a}_x+(-2-2)\mathbf{a}_y+(1-3)\mathbf{a}_z.$$
- The result is $\mathbf{R}_{PQ}=\mathbf{a}_x-4\mathbf{a}_y-2\mathbf{a}_z$.
- Figure 1.3(c) shows $\mathbf{r}_P$, $\mathbf{r}_Q$, and $\mathbf{R}_{PQ}$.
- D1.1 asks for $\mathbf{R}_{MN}$, $\mathbf{R}_{MN}+\mathbf{R}_{MP}$, $|\mathbf{r}_M|$, $\mathbf{a}_{MP}$, and $|2\mathbf{r}_P-3\mathbf{r}_N|$.
