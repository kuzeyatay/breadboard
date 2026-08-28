---
title: "Dot Product as Scalar Projection"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "dot-product-as-scalar-projection"
locations: ["Page 20", "Page 21", "Page 22"]
related: ["vector-magnitude-and-normalization", "dot-product-operational-formula", "dot-product-applications-to-work-and-flux", "directional-projection-worked-procedure"]
---

## ConceptNode: Dot Product as Scalar Projection

Planning node for [[dot-product-as-scalar-projection|1.13 Dot Product as Scalar Projection]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 20, Page 21, Page 22

The dot product measures how strongly one vector lies along another direction. Geometrically, for vectors $\mathbf{A}$ and $\mathbf{B}$ separated by the smaller angle $\theta_{AB}$, $$\mathbf{A}\cdot\mathbf{B}=|\mathbf{A}||\mathbf{B}|\cos\theta_{AB}.$$ The result is a scalar. Because cosine is unchanged when the vector order is reversed, the dot product is commutative: $\mathbf{A}\cdot\mathbf{B}=\mathbf{B}\cdot\mathbf{A}$. When the second vector is a unit vector $\mathbf{a}$, $$\mathbf{B}\cdot\mathbf{a}=|\mathbf{B}|\cos\theta_{Ba}$$ is the signed scalar component of $\mathbf{B}$ in the $\mathbf{a}$ direction. It is positive for an acute or right angle range up to $90^\circ$ and negative for angles from $90^\circ$ to $180^\circ$. Multiplying this scalar by the direction vector gives the vector projection: $$(\mathbf{B}\cdot\mathbf{a})\mathbf{a}.$$ Figure 1.4 distinguishes the scalar component from the vector component.

### Key planning details

- The dot product returns a scalar.
- Its magnitude depends on the cosine of the included angle.
- The dot product is commutative.
- Dotting with a unit vector gives a signed scalar component.
- A negative projection indicates a component opposite the chosen direction.
- Multiplying the scalar projection by the unit vector gives the vector projection.
- Projection requires a correctly normalized direction vector.

### Source coverage

- Equation (3) gives $\mathbf{A}\cdot\mathbf{B}=|\mathbf{A}||\mathbf{B}|\cos\theta_{AB}$.
- Equation (4) states $\mathbf{A}\cdot\mathbf{B}=\mathbf{B}\cdot\mathbf{A}$.
- Figure 1.4(a) shows the scalar component $\mathbf{B}\cdot\mathbf{a}$.
- Figure 1.4(b) shows the vector component $(\mathbf{B}\cdot\mathbf{a})\mathbf{a}$.
- The source identifies $\mathbf{B}\cdot\mathbf{a}$ as the projection of $\mathbf{B}$ in the $\mathbf{a}$ direction.
