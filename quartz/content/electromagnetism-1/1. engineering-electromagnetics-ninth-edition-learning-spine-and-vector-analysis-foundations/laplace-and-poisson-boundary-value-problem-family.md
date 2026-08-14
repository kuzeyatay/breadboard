---
title: "1.100 Laplace and Poisson Boundary-Value Problem Family"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 190", "Page 191", "Page 192", "Page 193"]
related: ["derivation-of-poissons-equation", "laplaces-equation-in-three-coordinate-systems", "boundary-conditions-and-the-uniqueness-theorem", "one-dimensional-poisson-solution-for-a-pn-junction", "capacitor-geometry-and-dielectric-design-problems"]
---

# 1.100 Laplace and Poisson Boundary-Value Problem Family

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 190, Page 191, Page 192, Page 193

The later problems consolidate a general workflow for electrostatic boundary-value calculations. First identify whether the region contains volume charge. Use Laplace's equation where $\rho_v=0$ and Poisson's equation where $\rho_v$ is specified. Next choose the coordinate system matching the geometry, reduce the equation by symmetry, integrate, and determine constants from conductor potentials, field conditions, regularity, behavior at infinity, and interface continuity. Problems include piecewise spherical potentials, prescribed exponential or polynomial potentials, grounded plates surrounding uniform charge, uniformly charged spheres, mixed charged-dielectric regions, and spatially varying permittivity. Several tasks reverse the usual direction by applying the Laplacian to a known $V$ to find $\rho_v$. Others require solving piecewise Laplace and Poisson equations and enforcing continuity of $V$ and $\mathbf{D}$ where no free surface charge exists. The set also tests linearity and uniqueness by asking which combinations of known harmonic functions satisfy both the equation and the original boundary values.

## Page-Grounded Details

#### Page 190

Figure 6.13 See Problem 6.21.

6.22 $\hookrightarrow$ A parallel-plate capacitor is air filled and has plate area A and plate separation d. Sufficient dielectric material of relative permittivity $\epsilon_{r}$ is available to fill half the capacitor volume. How should the material be used to maximize the capacitance, and by what factor will the capacitance increase over the air-filled case?

6.23 $\hookrightarrow$ A two-wire transmission line consists of two parallel perfectly conducting cylinders, each having a radius of 0.2 mm, separated by a center-to-center distance of 2 mm. The medium surrounding the wires has $\epsilon_{r}=3$ and $\sigma=1.5$ mS/m. A 100-V battery is connected between the wires. (a) Calculate the magnitude of the charge per meter length on each wire. (b) Using the result of Problem 6.16, find the battery current.

6.24 $\hookrightarrow$ A potential field in free space is given in spherical coordinates as
$$
V(r)=\begin{cases}[\rho_{0}/(6\epsilon_{0})][3a^{2}-r^{2}]&(r\leq a)\\(a^{3}\rho_{0})/(3\epsilon_{0}r)&(r\geq a)\end{cases}
$$
where $\rho_{0}$ and a are constants. (a) Use Poisson's equation to find the volume charge density everywhere. (

[Truncated for analysis]

#### Page 191

6.25 A capacitor is formed from concentric spherical conductors having radii a and b, where b >a. The inner conductor is raised to potential $V_{0}$ ; the outer conductor is grounded. Under these conditions, derive Eq.(39) using Laplace's equation.

6.26 Given the spherically symmetric potential field in free space, $V=V_{0}e^{-r/a}$ ,find.(a) $\rho_{v}$ at r=a;(b) the electric field at r=a;(c) the total charge.

6.27 Let $V(x,y)=4e^{2x}+f(x)-3y^{2}$ in a region of free space where $\rho_{v}=0$ . It is known that both $E_{x}$ and V are zero at the origin. Find f(x) and V(x, y).

6.28 Show that in a homogeneous medium of conductivity $\sigma$ , the potential field V satisfies Laplace's equation if any volume charge density present does not vary with time.

6.29 What total charge must be located within a unit sphere centered at the origin in free space in order to produce the potential field $V(r)=-6r^{5}/\epsilon_{0}$ for $r\leq 1$ ?

6.30 A parallel-plate capacitor has plates located at z=0 and z=d. The region between plates is filled with a material that contains volume charge of uniform density $\rho_{0}$ C/m^3 and has permittivity $\epsilon$ . Both plates a

[Truncated for analysis]

#### Page 192

solving Laplace's and Poisson's equations, find (a) $V(z)$ for $0 < z < d$; (b) the electric field intensity for $0 < z < d$. No surface charge exists at $z = b$, so both $V$ and $\mathbf{D}$ are continuous there.

6.35 In spherical coordinates, a potential is known to be a function of $\theta$ only. (a) Find the function $V(\theta)$ if $V = 10\ V$ at $\theta = 90^{\circ}$ and $\mathbf{E} = -500\ \mathbf{a}_{\theta}\ V/m$ at $\theta = 30^{\circ}$, $r = 0.4\ m$; (b) find the electric field intensity in rectangular coordinates at $\theta = 90^{\circ}$, $r = 1\ m$.

6.36 The derivation of Laplace's and Poisson's equations assumed constant permittivity, but there are cases of spatially varying permittivity in which the equations will still apply. Consider the vector identity, $\nabla\cdot(\psi\mathbf{G})=\mathbf{G}\cdot\nabla\psi+\psi\nabla\cdot\mathbf{G}$, where $\psi$ and $\mathbf{G}$ are scalar and vector functions, respectively. Determine a general rule on the allowed directions in which $\epsilon$ may vary with respect to the local electric field.

6.37 Coaxial conducting cylinders are located at $\rho = 0.5\ cm$ and $\rho = 1.2\ cm$. The

[Truncated for analysis]

#### Page 193

6.40

A parallel-plate capacitor is made using two circular plates of radius $a$, with the bottom plate on the $xy$ plane, centered at the origin. The top plate is located at $z=d$, with its center on the $z$ axis. Potential $V_{0}$ is on the top plate; the bottom plate is grounded. Dielectric having radially dependent permittivity fills the region between plates. The permittivity is given by $\epsilon(\rho)=\epsilon_{0}(1+\rho^{2}/a^{2})$. Find (a) $V(z)$; (b) E; (c) Q; (d) C. This is a reprise of Problem 6.8, but it starts with Laplace's equation.

6.41

Concentric conducting spheres are located at $r=5$ mm and $r=20$ mm. The region between the spheres is filled with a perfect dielectric. If the inner sphere is at 100 V and the outer sphere is at 0 V, (a) find the location of the 20 V equipotential surface. (b) Find $E_{r,\max}$. (c) Find $\epsilon_{r}$ if the surface charge density on the inner sphere is $1.0\ \mu C/m^{2}$.

6.42

The hemisphere $0<r<a$, $0<\theta<\pi/2$, is composed of homogeneous conducting material of conductivity $\sigma$. The flat side of the hemisphere rests on a perfectly conducting plane. Now, the material within the conical

[Truncated for analysis]

## Core Ideas

- Choose Laplace's equation for charge-free regions and Poisson's equation for regions containing volume charge.
- Use geometry to select rectangular, cylindrical, or spherical coordinates.
- Boundary values determine integration constants.
- Regularity at the origin and decay at infinity can serve as boundary conditions.
- Known potentials can be differentiated twice to recover volume charge density.
- Piecewise media require continuity conditions at interfaces.
- Linearity of Laplace's equation does not guarantee preservation of boundary values.

## Source Anchors

- Problem 6.24 gives a piecewise spherical potential and asks for charge density and total charge.
- Problem 6.25 asks for the concentric-sphere potential by solving Laplace's equation.
- Problem 6.27 uses $V(x,y)=4e^{2x}+f(x)-3y^2$ with $\rho_v=0$ and conditions at the origin.
- Problem 6.30 places uniform volume charge between grounded parallel plates.
- Problem 6.32 places uniform volume charge inside a grounded spherical shell.
- Problem 6.34 requires Poisson and Laplace solutions on opposite sides of an interface with continuous $V$ and $\mathbf{D}$.
- Problem 6.36 investigates when spatially varying $\epsilon$ remains compatible with the displayed Laplace and Poisson forms.
- Problem 6.46 asks for center potential using conditions at $r=0$ and $r=a$.

## Related Pages

- [[derivation-of-poissons-equation|Derivation of Poisson's Equation]]
- [[laplaces-equation-in-three-coordinate-systems|Laplace's Equation in Three Coordinate Systems]]
- [[boundary-conditions-and-the-uniqueness-theorem|Boundary Conditions and the Uniqueness Theorem]]
- [[one-dimensional-poisson-solution-for-a-pn-junction|One-Dimensional Poisson Solution for a pn Junction]]
- [[capacitor-geometry-and-dielectric-design-problems|Capacitor Geometry and Dielectric Design Problems]]

## Concept Dependencies

- depends-on: [[boundary-conditions-and-the-uniqueness-theorem|Boundary Conditions and the Uniqueness Theorem]]
- applies-to: [[derivation-of-poissons-equation|Derivation of Poisson's Equation]]
- applies-to: [[laplaces-equation-in-three-coordinate-systems|Laplace's Equation in Three Coordinate Systems]]
- related: [[capacitor-geometry-and-dielectric-design-problems|Capacitor Geometry and Dielectric Design Problems]]
