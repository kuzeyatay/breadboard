---
title: "1.26 Spherical Differential Lengths, Areas, and Volume"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 31", "Figure 1.8d", "Page 32", "Section: 1.9.3 Differential Surfaces and Volume"]
related: ["spherical-coordinates-and-coordinate-surfaces", "cylindrical-differential-lengths-areas-and-volume", "coordinate-system-applications-and-integration-tasks"]
---

# 1.26 Spherical Differential Lengths, Areas, and Volume

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 31, Figure 1.8d, Page 32, Section: 1.9.3 Differential Surfaces and Volume

The spherical differential volume element follows from three local orthogonal lengths. Increasing $r$ by $dr$ separates neighboring spheres by $dr$. Increasing $\theta$ by $d\theta$ separates neighboring cones by the arc length $r\,d\theta$. Increasing $\phi$ by $d\phi$ separates neighboring radial planes by $r\sin\theta\,d\phi$, because the relevant circle around the $z$ axis has radius $r\sin\theta$. Pairwise products of these lengths give the differential surface areas, while the product of all three gives the volume. The resulting factor $r^2\sin\theta$ records how coordinate spacing expands with radius and varies with polar angle. Figure 1.8d is source-central because it shows the differential cell whose edge lengths motivate these formulas rather than presenting the formulas as facts to memorize.

## Page-Grounded Details

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

- The radial differential length is $dr$.
- The polar differential length is $r\,d\theta$.
- The azimuthal differential length is $r\sin\theta\,d\phi$.
- One differential area is $r\,dr\,d\theta$.
- A second differential area is $r\sin\theta\,dr\,d\phi$.
- The area on a sphere is $r^2\sin\theta\,d\theta\,d\phi$.
- The differential volume is $dv=r^2\sin\theta\,dr\,d\theta\,d\phi$.

## Source Anchors

- Figure 1.8d shows the spherical differential volume element.
- The distance between neighboring spheres is stated as $dr$.
- The distance between neighboring cones is stated as $r d\theta$.
- The distance between neighboring radial planes is stated as $r\sin\theta d\phi$.
- The three surface areas and the volume $r^2\sin\theta dr d\theta d\phi$ are explicitly listed.

## Related Pages

- [[spherical-coordinates-and-coordinate-surfaces|Spherical Coordinates and Coordinate Surfaces]]
- [[cylindrical-differential-lengths-areas-and-volume|Cylindrical Differential Lengths, Areas, and Volume]]
- [[coordinate-system-applications-and-integration-tasks|Coordinate-System Applications and Integration Tasks]]

