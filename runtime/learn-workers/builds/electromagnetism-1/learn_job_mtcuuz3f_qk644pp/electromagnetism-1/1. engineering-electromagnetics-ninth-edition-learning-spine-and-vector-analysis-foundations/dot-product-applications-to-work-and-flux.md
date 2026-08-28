---
title: "1.15 Dot Product Applications to Work and Flux"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 21"]
related: ["dot-product-as-scalar-projection", "differential-elements-in-rectangular-coordinates", "scalar-and-vector-fields", "electromagnetics-learning-progression"]
source_images: ["/electromagnetism-1/assets/engineering-electromagnetics-9th-ed-9nbsped-compress-page-021.png"]
---

# 1.15 Dot Product Applications to Work and Flux

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 21

The dot product naturally represents physical quantities that depend on the component of one vector along another. For a constant force $\mathbf{F}$ acting through a straight displacement $\mathbf{L}$, the work is $FL\cos\theta$, compactly written as $\mathbf{F}\cdot\mathbf{L}$. If the force changes along the path, differential displacements must be accumulated through the line integral
$$
\text{Work}=\int \mathbf{F}\cdot d\mathbf{L}
$$
 Flux uses an analogous projection onto a surface normal. A vector surface $\mathbf{S}$ has the surface area as its magnitude and a direction normal to the surface. For uniform magnetic flux density $\mathbf{B}$ over a flat surface, the flux is $\mathbf{B}\cdot\mathbf{S}$. If the flux density varies across the surface, the total flux is
$$
\Phi=\int \mathbf{B}\cdot d\mathbf{S}
$$
 These applications show why differential line and surface elements require orientation as well as size.

## Source Figures and Snapshots

![engineering-electromagnetics-9th-ed-9nbsped_compress Page 21](/electromagnetism-1/assets/engineering-electromagnetics-9th-ed-9nbsped-compress-page-021.png)

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

## Core Ideas

- Work uses the force component parallel to displacement.
- Constant-force work is $\mathbf{F}\cdot\mathbf{L}$.
- Variable-force work requires a line integral.
- A vector surface points normal to its surface.
- Flux uses the field component normal to the surface.
- Uniform-field flux is $\mathbf{B}\cdot\mathbf{S}$.
- Nonuniform-field flux requires a surface integral.

## Source Anchors

- The source writes constant-force work as $\mathbf{F}\cdot\mathbf{L}$.
- Variable-force work is written $\text{Work}=\int\mathbf{F}\cdot d\mathbf{L}$.
- The vector surface $\mathbf{S}$ has area as magnitude and a surface-normal direction.
- Uniform magnetic flux is written $\mathbf{B}\cdot\mathbf{S}$.
- Nonuniform flux is written $\Phi=\int\mathbf{B}\cdot d\mathbf{S}$.
- The text notes that electric-flux integrals of the same form appear in Chapter 3.

## Related Pages

- [[dot-product-as-scalar-projection|Dot Product as Scalar Projection]]
- [[differential-elements-in-rectangular-coordinates|Differential Elements in Rectangular Coordinates]]
- [[scalar-and-vector-fields|Scalar and Vector Fields]]
- [[electromagnetics-learning-progression|Electromagnetics Learning Progression]]

## Concept Dependencies

- depends-on: [[differential-elements-in-rectangular-coordinates|Differential Elements in Rectangular Coordinates]]
- example-of: [[dot-product-as-scalar-projection|Dot Product as Scalar Projection]]
