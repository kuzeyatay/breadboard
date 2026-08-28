---
title: "1.25 Spherical Coordinates and Coordinate Surfaces"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 30", "Section: 1.9 The Spherical Coordinate System", "Page 31", "Figure 1.8a", "Figure 1.8b", "Section: 1.9.1 Coordinates of a Point", "Page 32"]
related: ["right-handed-curvilinear-unit-vector-bases", "spherical-differential-lengths-areas-and-volume", "rectangular-and-spherical-point-transformations"]
---

# 1.25 Spherical Coordinates and Coordinate Surfaces

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 30, Section: 1.9 The Spherical Coordinate System, Page 31, Figure 1.8a, Figure 1.8b, Section: 1.9.1 Coordinates of a Point, Page 32

Spherical coordinates locate a point by a radial distance and two angles. The coordinate $r$ is the nonnegative distance from the origin, and $r=\text{constant}$ defines a sphere. The polar angle $\theta$ is measured from the positive $z$ axis, and $\theta=\text{constant}$ defines a cone. The azimuth $\phi$ is the same angle used in cylindrical coordinates, measured from the positive $x$ axis to the projection of the radius vector in the $z=0$ plane; $\phi=\text{constant}$ defines a plane through the $z$ axis. A point is therefore the intersection of a sphere, cone, and radial plane. The source compares $\theta$ with latitude but emphasizes that latitude is measured from the equator, whereas $\theta$ is measured from the north-pole direction. Figures 1.8a and 1.8b are central geometric references for the coordinate definitions and surfaces.

## Page-Grounded Details

#### Page 30

Table 1.1 Dot products of unit vectors in cylindrical and rectangular coordinate systems

<table><tr><td></td><td>$a_{\rho}$</td><td>$a_{\phi}$</td><td>$a_{z}$</td></tr><tr><td>$a_{x}$</td><td>$\cos\phi$</td><td>$-\sin\phi$</td><td>0</td></tr><tr><td>$a_{y}$</td><td>$\sin\phi$</td><td>$\cos\phi$</td><td>0</td></tr><tr><td>$a_{z}$</td><td>0</td><td>0</td><td>1</td></tr></table>

Transforming vectors from rectangular to cylindrical coordinates or vice versa is therefore accomplished by using (10) or (11) to change variables, and by using the dot products of the unit vectors given in Table 1.1 to change components. The two steps may be taken in either order.

### EXAMPLE 1.3

Transform the vector $B = y a_{x} - x a_{y} + z a_{z}$ into cylindrical coordinates.

Solution. The new components are
$$ \begin{array} { r l } & { B \rho = B \cdot a_{\rho}= y (a_{x} \cdot a_{\rho}) - x (a_{y} \cdot a_{\rho} ) } \\ & { \qquad= y \cos \phi - x \sin \phi= \rho \sin \phi \cos \phi - \rho \cos \phi \sin \phi= 0 } \\ & { B_{\phi}= B \cdot a_{\phi}= y (a_{x} \cdot a_{\phi}) - x (a_{y} \cdot a_{\phi} ) } \\ & { \qquad= - y \sin \phi - x \cos \phi= - \rho \sin^{2} \phi - \rho \cos^{2} \phi= - \rho }

[Truncated for analysis]

#### Page 31

Figure 1.8 (a) The three spherical coordinates. (b) The three mutually perpendicular surfaces of the spherical coordinate system. (c) The three unit vectors of spherical coordinates: $\mathbf{a}_{r} \times \mathbf{a}_{\theta} = \mathbf{a}_{\phi}$ (d) The differential volume element in the spherical coordinate system.

latitude-and-longitude system of locating a place on the surface of the earth, but usually we consider only points on the surface and not those below or above ground.

#### 1.9.1 Coordinates of a Point

We begin by building a spherical coordinate system on the three rectangular axes (Figure 1.8a). The distance from the origin to any point is defined as $r$. The surface $r = \text{constant}$ is a sphere.

The second coordinate is an angle $\theta$ between the $z$ axis and the line drawn from the origin to the point in question. The surface $\theta = \text{constant}$ is a cone, and the two surfaces, cone and sphere, are everywhere perpendicular along their intersection, which is a circle of radius $r\sin\theta$. The coordinate $\theta$ corresponds to latitude, except that latitude is measured from the equator and $\theta$ is measured from the "North Po

[Truncated for analysis]

#### Page 32

The third coordinate $\phi$ is also an angle and is exactly the same as the angle $\phi$ of cylindrical coordinates. It is the angle between the x axis and the projection in the $z=0$ plane of the line drawn from the origin to the point. It corresponds to the angle of longitude, but the angle $\phi$ increases to the "east." The surface $\phi=\mathrm{constant}$ is a plane passing through the $\theta=0$ line (or the z axis).

We again consider any point as the intersection of three mutually perpendicular surfaces-a sphere, a cone, and a plane-each oriented in the manner just described. The three surfaces are shown in Figure 1.8b.

#### 1.9.2 Unit Vectors in Spherical Coordinates

Three unit vectors may again be defined at any point. Each unit vector is perpendicular to one of the three mutually perpendicular surfaces and is oriented in that direction in which the coordinate increases. The unit vector $\mathbf{a}_{r}$ is directed radially outward, normal to the sphere $r=\mathrm{constant}$, and lies in the cone $\theta=\mathrm{constant}$ and the plane $\phi=\mathrm{constant}$. The unit vector $\mathbf{a}_{\theta}$ is normal to the conical surface, lies in the pla

[Truncated for analysis]

## Core Ideas

- $r$ is radial distance from the origin.
- $r=\text{constant}$ is a sphere.
- $\theta$ is measured from the positive $z$ axis.
- $\theta=\text{constant}$ is a cone.
- $\phi$ is the cylindrical azimuthal angle.
- $\phi=\text{constant}$ is a plane through the $z$ axis.
- The intersection of a sphere, cone, and plane locates a point.
- $\theta$ differs from geographic latitude because their reference directions differ.

## Source Anchors

- Figure 1.8a displays the three spherical coordinates.
- Figure 1.8b displays the three mutually perpendicular spherical coordinate surfaces.
- The circle where a sphere and cone intersect has radius $r\sin\theta$.
- The source states that $\phi$ increases toward the east.
- The source describes the three locating surfaces as a sphere, cone, and plane.

## Related Pages

- [[right-handed-curvilinear-unit-vector-bases|Right-Handed Curvilinear Unit-Vector Bases]]
- [[spherical-differential-lengths-areas-and-volume|Spherical Differential Lengths, Areas, and Volume]]
- [[rectangular-and-spherical-point-transformations|Rectangular and Spherical Point Transformations]]

## Concept Dependencies

- related: [[right-handed-curvilinear-unit-vector-bases|Right-Handed Curvilinear Unit-Vector Bases]]
- related: [[spherical-differential-lengths-areas-and-volume|Spherical Differential Lengths, Areas, and Volume]]
