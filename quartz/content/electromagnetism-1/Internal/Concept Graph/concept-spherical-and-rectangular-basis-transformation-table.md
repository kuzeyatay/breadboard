---
title: "Spherical and Rectangular Basis Transformation Table"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "spherical-and-rectangular-basis-transformation-table"
locations: ["Page 31", "Figure 1.8c", "Page 33", "Table 1.2", "Section: 1.9.5 Vector Component Transformations"]
related: ["right-handed-curvilinear-unit-vector-bases", "vector-component-transformation-by-projection", "worked-curvilinear-vector-field-transformations"]
---

## ConceptNode: Spherical and Rectangular Basis Transformation Table

Planning node for [[spherical-and-rectangular-basis-transformation-table|1.28 Spherical and Rectangular Basis Transformation Table]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 31, Figure 1.8c, Page 33, Table 1.2, Section: 1.9.5 Vector Component Transformations

Table 1.2 provides the dot products needed to convert vector components between spherical and rectangular bases. Each entry is a directional cosine. For example, projecting $\mathbf{a}_r$ into the $xy$ plane gives a magnitude $\sin\theta$, and projecting that result onto the $x$ axis gives $\mathbf{a}_x\cdot\mathbf{a}_r=\sin\theta\cos\phi$. The $z$ projections follow directly from the geometry: $\mathbf{a}_z\cdot\mathbf{a}_r=\cos\theta$, $\mathbf{a}_z\cdot\mathbf{a}_\theta=-\sin\theta$, and $\mathbf{a}_z\cdot\mathbf{a}_\phi=0$. Similar two-stage projections produce the remaining entries. The table is not merely a lookup device. It encodes how each local spherical direction is oriented relative to the fixed rectangular axes, allowing any vector to be projected into either basis.

### Key planning details

- $\mathbf{a}_x\cdot\mathbf{a}_r=\sin\theta\cos\phi$.
- $\mathbf{a}_y\cdot\mathbf{a}_r=\sin\theta\sin\phi$.
- $\mathbf{a}_z\cdot\mathbf{a}_r=\cos\theta$.
- $\mathbf{a}_x\cdot\mathbf{a}_\theta=\cos\theta\cos\phi$.
- $\mathbf{a}_y\cdot\mathbf{a}_\theta=\cos\theta\sin\phi$.
- $\mathbf{a}_z\cdot\mathbf{a}_\theta=-\sin\theta$.
- $\mathbf{a}_x\cdot\mathbf{a}_\phi=-\sin\phi$ and $\mathbf{a}_y\cdot\mathbf{a}_\phi=\cos\phi$.
- $\mathbf{a}_z\cdot\mathbf{a}_\phi=0$.

### Source coverage

- Table 1.2 lists all nine dot products between rectangular and spherical unit vectors.
- The text derives $\mathbf{a}_r\cdot\mathbf{a}_x$ through successive projection onto the $xy$ plane and then the $x$ axis.
- The $z$-direction dot products are listed as $\cos\theta$, $-\sin\theta$, and $0$.
- Example 1.4 immediately applies the table to transform a vector field.
- Figure 1.8c supplies the geometry used to derive the table.
