---
title: "1.20 Right-Handed Curvilinear Unit-Vector Bases"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 26", "Section: 1.8.2 Unit Vectors", "Page 27", "Figure 1.6b", "Page 31", "Figure 1.8c", "Page 32", "Section: 1.9.2 Unit Vectors in Spherical Coordinates"]
related: ["operational-cross-product-in-rectangular-components", "cylindrical-coordinates-and-coordinate-surfaces", "spherical-coordinates-and-coordinate-surfaces", "vector-component-transformation-by-projection"]
---

# 1.20 Right-Handed Curvilinear Unit-Vector Bases

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 26, Section: 1.8.2 Unit Vectors, Page 27, Figure 1.6b, Page 31, Figure 1.8c, Page 32, Section: 1.9.2 Unit Vectors in Spherical Coordinates

Unit vectors in curvilinear systems are defined locally from constant-coordinate surfaces. Each basis vector is normal to the surface on which its coordinate is constant and points toward increasing values of that coordinate. In cylindrical coordinates, $\mathbf{a}_\rho$ points radially outward, $\mathbf{a}_\phi$ is tangent to the cylinder and points toward increasing $\phi$, and $\mathbf{a}_z$ is identical to the rectangular $z$ unit vector. Unlike rectangular basis vectors, $\mathbf{a}_\rho$ and $\mathbf{a}_\phi$ change direction as $\phi$ changes, so they cannot be treated as constants during differentiation or integration with respect to $\phi$. In spherical coordinates, $\mathbf{a}_r$ points outward, $\mathbf{a}_\theta$ points toward increasing polar angle, and $\mathbf{a}_\phi$ points toward increasing azimuth. Both bases are orthonormal and right-handed, but their cyclic orders differ because their coordinate orders differ.

## Page-Grounded Details

#### Page 26

#### 1.8 OTHER COORDINATE SYSTEMS: CIRCULAR CYLINDRICAL COORDINATES

The rectangular coordinate system is generally the one in which students prefer to work every problem. This often means a lot more work, because many problems possess a type of symmetry that pleads for a more logical treatment. It is easier to do now, once and for all, the work required to become familiar with cylindrical and spherical coordinates, instead of applying an equal or greater effort to every problem involving cylindrical or spherical symmetry later. With this in mind, we will take a careful and unhurried look at cylindrical and spherical coordinates.

##### 1.8.1 Point Coordinates

The circular cylindrical coordinate system is the three-dimensional version of the polar coordinates of analytic geometry. In polar coordinates, a point is located in a plane by giving both its distance $\rho$ from the origin and the angle $\phi$ between the line from the point to the origin and an arbitrary radial line, taken as $\phi=0$.^3 In circular cylindrical coordinates, we also specify the distance $z$ of the point from an arbitrary $z=0$ reference plane. For simplicity, we usually refer to circular cylindr

[Truncated for analysis]

#### Page 27

Figure 1.6 (a) The three mutually perpendicular surfaces of the circular cylindrical coordinate system. (b) The three unit vectors of the circular cylindrical coordinate system. (c) The differential volume unit in the circular cylindrical coordinate system; $d\rho$, $\rho d\phi$, and $dz$ are all elements of length.

The unit vector $\mathbf{a}_{\rho}$ at a point $P(\rho_{1}, \phi_{1}, z_{1})$ is directed radially outward, normal to the cylindrical surface $\rho = \rho_{1}$. It lies in the planes $\phi = \phi_{1}$ and $z = z_{1}$. The unit vector $\mathbf{a}_{\phi}$ is normal to the plane $\phi = \phi_{1}$, points in the direction of increasing $\phi$, lies in the plane $z = z_{1}$, and is tangent to the cylindrical surface $\rho = \rho_{1}$. The unit vector $\mathbf{a}_{z}$ is the same as the unit vector $\mathbf{a}_{z}$ of the rectangular coordinate system. Figure 1.6_b shows the three vectors in cylindrical coordinates.

In rectangular coordinates, the unit vectors are not functions of the coordinates. Two of the unit vectors in cylindrical coordinates, $\mathbf{a}_{\rho}$ and $\mathbf{a}_{\phi}$, however, $do$ vary with the coordinate $ \phi

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

- A curvilinear unit vector is normal to its constant-coordinate surface.
- $\mathbf{a}_\rho$ and $\mathbf{a}_\phi$ depend on $\phi$.
- $\mathbf{a}_z$ is shared by rectangular and cylindrical coordinates.
- The cylindrical orientation satisfies $\mathbf{a}_\rho\times\mathbf{a}_\phi=\mathbf{a}_z$.
- $\mathbf{a}_r$ is normal to a sphere and points outward.
- $\mathbf{a}_\theta$ is tangent to a sphere and points toward increasing $\theta$.
- $\mathbf{a}_\phi$ is shared by cylindrical and spherical coordinates.
- The spherical orientation satisfies $\mathbf{a}_r\times\mathbf{a}_\theta=\mathbf{a}_\phi$.

## Source Anchors

- Figure 1.6b depicts the three cylindrical unit vectors.
- The text explicitly warns that $\mathbf{a}_\rho$ and $\mathbf{a}_\phi$ vary with $\phi$.
- Figure 1.8c depicts the spherical basis and states $\mathbf{a}_r\times\mathbf{a}_\theta=\mathbf{a}_\phi$.
- $\mathbf{a}_\theta$ is described as pointing south along a line analogous to longitude.
- $\mathbf{a}_\phi$ is described as pointing east and being tangent to both the cone and sphere.

## Related Pages

- [[operational-cross-product-in-rectangular-components|Operational Cross Product in Rectangular Components]]
- [[cylindrical-coordinates-and-coordinate-surfaces|Cylindrical Coordinates and Coordinate Surfaces]]
- [[spherical-coordinates-and-coordinate-surfaces|Spherical Coordinates and Coordinate Surfaces]]
- [[vector-component-transformation-by-projection|Vector Component Transformation by Projection]]

