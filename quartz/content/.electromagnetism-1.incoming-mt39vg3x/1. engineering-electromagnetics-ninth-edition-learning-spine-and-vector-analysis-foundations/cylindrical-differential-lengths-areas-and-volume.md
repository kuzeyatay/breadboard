---
title: "1.21 Cylindrical Differential Lengths, Areas, and Volume"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 27", "Figure 1.6c", "Page 28", "Section: 1.8.3 Differential Area and Volume"]
related: ["cylindrical-coordinates-and-coordinate-surfaces", "spherical-differential-lengths-areas-and-volume", "coordinate-system-applications-and-integration-tasks"]
---

# 1.21 Cylindrical Differential Lengths, Areas, and Volume

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 27, Figure 1.6c, Page 28, Section: 1.8.3 Differential Area and Volume

A small cylindrical-coordinate volume is formed by incrementing $\rho$, $\phi$, and $z$ by $d\rho$, $d\phi$, and $dz$. Its limiting shape has three orthogonal side lengths: $d\rho$ in the radial direction, $\rho\,d\phi$ in the azimuthal direction, and $dz$ in the axial direction. The factor $\rho$ is necessary because $d\phi$ is an angular increment and therefore dimensionless, while the corresponding arc length is $\rho d\phi$. Multiplying pairs of side lengths gives the differential face areas, and multiplying all three gives the volume element. Thus the geometry directly produces the cylindrical Jacobian factor $\rho$. Figure 1.6c is central to this derivation because it presents the truncated wedge and labels the three physical edge lengths from which all area and volume expressions follow.

## Page-Grounded Details

#### Page 27

Figure 1.6 (a) The three mutually perpendicular surfaces of the circular cylindrical coordinate system. (b) The three unit vectors of the circular cylindrical coordinate system. (c) The differential volume unit in the circular cylindrical coordinate system; $d\rho$, $\rho d\phi$, and $dz$ are all elements of length.

The unit vector $\mathbf{a}_{\rho}$ at a point $P(\rho_{1}, \phi_{1}, z_{1})$ is directed radially outward, normal to the cylindrical surface $\rho = \rho_{1}$. It lies in the planes $\phi = \phi_{1}$ and $z = z_{1}$. The unit vector $\mathbf{a}_{\phi}$ is normal to the plane $\phi = \phi_{1}$, points in the direction of increasing $\phi$, lies in the plane $z = z_{1}$, and is tangent to the cylindrical surface $\rho = \rho_{1}$. The unit vector $\mathbf{a}_{z}$ is the same as the unit vector $\mathbf{a}_{z}$ of the rectangular coordinate system. Figure 1.6_b shows the three vectors in cylindrical coordinates.

In rectangular coordinates, the unit vectors are not functions of the coordinates. Two of the unit vectors in cylindrical coordinates, $\mathbf{a}_{\rho}$ and $\mathbf{a}_{\phi}$, however, $do$ vary with the coordinate $ \phi

[Truncated for analysis]

#### Page 28

#### 1.8.3 Differential Area and Volume

A differential volume element in cylindrical coordinates may be obtained by increasing $\rho$, $\phi$, and $z$ by the differential increments $d\rho$, $d\phi$, and $dz$. The two cylinders of radius $\rho$ and $\rho+d\rho$, the two radial planes at angles $\phi$ and $\phi+d\phi$, and the two "horizontal" planes at "elevations" $z$ and $z+dz$ now enclose a small volume, as shown in Figure 1.6$c$, having the shape of a truncated wedge. As the volume element becomes very small, its shape approaches that of a rectangular parallelepiped having sides of length $d\rho$, $\rho d\phi$, and $dz$. Note that $d\rho$ and $dz$ are dimensionally lengths, but $d\phi$ is not; $\rho d\phi$ is the length. The surfaces have areas of $\rho\,d\rho\,d\phi$, $d\rho\,dz$, and $\rho\,d\phi\,dz$, and the volume is the product of the three side lengths, or $\rho\,d\rho\,d\phi\,dz$.

#### 1.8.4 Point Transformations

The variables of the rectangular and cylindrical coordinate systems are easily related to each other. Referring to Figure 1.7, we see that
$$
x=\rho\cos\phi
$$
$$
y=\rho\sin\phi
$$
$$
z=z
$$
(10)

From the

[Truncated for analysis]

## Core Ideas

- The radial differential length is $d\rho$.
- The azimuthal differential length is $\rho\,d\phi$.
- The axial differential length is $dz$.
- The face normal to $\mathbf{a}_z$ has area $\rho\,d\rho\,d\phi$.
- The face normal to $\mathbf{a}_\phi$ has area $d\rho\,dz$.
- The face normal to $\mathbf{a}_\rho$ has area $\rho\,d\phi\,dz$.
- The differential volume is $dv=\rho\,d\rho\,d\phi\,dz$.

## Source Anchors

- Figure 1.6c labels the differential side lengths $d\rho$, $\rho d\phi$, and $dz$.
- The volume is bounded by two cylinders, two radial planes, and two horizontal planes.
- The text emphasizes that $d\phi$ is not a length but $\rho d\phi$ is.
- The listed differential surface areas are $\rho d\rho d\phi$, $d\rho dz$, and $\rho d\phi dz$.
- The volume element is stated as $\rho d\rho d\phi dz$.

## Related Pages

- [[cylindrical-coordinates-and-coordinate-surfaces|Cylindrical Coordinates and Coordinate Surfaces]]
- [[spherical-differential-lengths-areas-and-volume|Spherical Differential Lengths, Areas, and Volume]]
- [[coordinate-system-applications-and-integration-tasks|Coordinate-System Applications and Integration Tasks]]

## Concept Dependencies

- contrasts-with: [[spherical-differential-lengths-areas-and-volume|Spherical Differential Lengths, Areas, and Volume]]
