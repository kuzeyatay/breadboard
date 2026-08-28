---
title: "1.28 Spherical and Rectangular Basis Transformation Table"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 31", "Figure 1.8c", "Page 33", "Table 1.2", "Section: 1.9.5 Vector Component Transformations"]
related: ["right-handed-curvilinear-unit-vector-bases", "vector-component-transformation-by-projection", "worked-curvilinear-vector-field-transformations"]
---

# 1.28 Spherical and Rectangular Basis Transformation Table

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 31, Figure 1.8c, Page 33, Table 1.2, Section: 1.9.5 Vector Component Transformations

Table 1.2 provides the dot products needed to convert vector components between spherical and rectangular bases. Each entry is a directional cosine. For example, projecting $\mathbf{a}_r$ into the $xy$ plane gives a magnitude $\sin\theta$, and projecting that result onto the $x$ axis gives $\mathbf{a}_x\cdot\mathbf{a}_r=\sin\theta\cos\phi$. The $z$ projections follow directly from the geometry: $\mathbf{a}_z\cdot\mathbf{a}_r=\cos\theta$, $\mathbf{a}_z\cdot\mathbf{a}_\theta=-\sin\theta$, and $\mathbf{a}_z\cdot\mathbf{a}_\phi=0$. Similar two-stage projections produce the remaining entries. The table is not merely a lookup device. It encodes how each local spherical direction is oriented relative to the fixed rectangular axes, allowing any vector to be projected into either basis.

## Page-Grounded Details

#### Page 31

Figure 1.8 (a) The three spherical coordinates. (b) The three mutually perpendicular surfaces of the spherical coordinate system. (c) The three unit vectors of spherical coordinates: $\mathbf{a}_{r} \times \mathbf{a}_{\theta} = \mathbf{a}_{\phi}$ (d) The differential volume element in the spherical coordinate system.

latitude-and-longitude system of locating a place on the surface of the earth, but usually we consider only points on the surface and not those below or above ground.

#### 1.9.1 Coordinates of a Point

We begin by building a spherical coordinate system on the three rectangular axes (Figure 1.8a). The distance from the origin to any point is defined as $r$. The surface $r = \text{constant}$ is a sphere.

The second coordinate is an angle $\theta$ between the $z$ axis and the line drawn from the origin to the point in question. The surface $\theta = \text{constant}$ is a cone, and the two surfaces, cone and sphere, are everywhere perpendicular along their intersection, which is a circle of radius $r\sin\theta$. The coordinate $\theta$ corresponds to latitude, except that latitude is measured from the equator and $\theta$ is measured from the "North Po

[Truncated for analysis]

#### Page 33

Table 1.2 Dot products of unit vectors in spherical and rectangular coordinate systems

<table><tr><td></td><td>$a_r$</td><td>$a_\theta$</td><td>$a_\phi$</td></tr><tr><td>$a_x\cdot$</td><td>$\sin\theta\cos\phi$</td><td>$\cos\theta\cos\phi$</td><td>$-\sin\phi$</td></tr><tr><td>$a_y\cdot$</td><td>$\sin\theta\sin\phi$</td><td>$\cos\theta\sin\phi$</td><td>$\cos\phi$</td></tr><tr><td>$a_z\cdot$</td><td>$\cos\theta$</td><td>$-\sin\theta$</td><td>0</td></tr></table>

The transformation in the reverse direction is achieved with the help of
$$
\begin{matrix}r = \sqrt{x^{2} + y^{2} + z^{2}} & (r \geq 0) \\ \theta = \cos^{-1}\frac{z}{\sqrt{x^{2} + y^{2} + z^{2}}} & (0^{\circ} \leq \theta \leq 180^{\circ}) \\ \phi = \tan^{-1}\frac{y}{x} & \end{matrix}\quad{(16)}
$$
The radius variable r is nonnegative, and $\theta$ is restricted to the range from $0^{\circ}$ to $180^{\circ}$, inclusive. The angles are placed in the proper quadrants by inspecting the signs of x, y, and z.

#### 1.9.5 Vector Component Transformations

The transformation of vectors requires us to determine the products of the unit vectors in rectangular and spherical coordinates. We work out these products from Figure 1.8

[Truncated for analysis]

## Core Ideas

- $\mathbf{a}_x\cdot\mathbf{a}_r=\sin\theta\cos\phi$.
- $\mathbf{a}_y\cdot\mathbf{a}_r=\sin\theta\sin\phi$.
- $\mathbf{a}_z\cdot\mathbf{a}_r=\cos\theta$.
- $\mathbf{a}_x\cdot\mathbf{a}_\theta=\cos\theta\cos\phi$.
- $\mathbf{a}_y\cdot\mathbf{a}_\theta=\cos\theta\sin\phi$.
- $\mathbf{a}_z\cdot\mathbf{a}_\theta=-\sin\theta$.
- $\mathbf{a}_x\cdot\mathbf{a}_\phi=-\sin\phi$ and $\mathbf{a}_y\cdot\mathbf{a}_\phi=\cos\phi$.
- $\mathbf{a}_z\cdot\mathbf{a}_\phi=0$.

## Source Anchors

- Table 1.2 lists all nine dot products between rectangular and spherical unit vectors.
- The text derives $\mathbf{a}_r\cdot\mathbf{a}_x$ through successive projection onto the $xy$ plane and then the $x$ axis.
- The $z$-direction dot products are listed as $\cos\theta$, $-\sin\theta$, and $0$.
- Example 1.4 immediately applies the table to transform a vector field.
- Figure 1.8c supplies the geometry used to derive the table.

## Related Pages

- [[right-handed-curvilinear-unit-vector-bases|Right-Handed Curvilinear Unit-Vector Bases]]
- [[vector-component-transformation-by-projection|Vector Component Transformation by Projection]]
- [[worked-curvilinear-vector-field-transformations|Worked Curvilinear Vector-Field Transformations]]

## Concept Dependencies

- depends-on: [[right-handed-curvilinear-unit-vector-bases|Right-Handed Curvilinear Unit-Vector Bases]]
