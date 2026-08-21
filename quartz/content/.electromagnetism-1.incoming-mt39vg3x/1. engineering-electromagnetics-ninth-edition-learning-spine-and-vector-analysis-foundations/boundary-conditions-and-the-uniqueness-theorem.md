---
title: "1.91 Boundary Conditions and the Uniqueness Theorem"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 176", "Page 191", "Page 192", "Page 193"]
related: ["laplaces-equation-in-three-coordinate-systems", "direct-integration-of-one-dimensional-laplace-problems", "laplace-and-poisson-boundary-value-problem-family"]
---

# 1.91 Boundary Conditions and the Uniqueness Theorem

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 176, Page 191, Page 192, Page 193

Laplace's equation alone does not identify a particular electrostatic field because every charge-free electrode configuration satisfies $\nabla^2V=0$. A specific solution emerges only when the geometry and boundary conditions are supplied. Conducting boundaries are equipotential surfaces, so their assigned potentials, such as $V_0$, $V_1$, or numerical voltage values, can define the problem. Other boundary conditions may specify the normal electric field, an equivalent surface charge density $\rho_S$, or a mixture of potential and field values on an enclosing surface. The Uniqueness Theorem states that a potential satisfying both the governing equation and all specified boundary conditions is the only possible solution. This theorem changes solution strategy: a candidate need not be obtained by one mandatory derivation method. If it satisfies Laplace's or Poisson's equation and the complete boundary data, it is the physical potential. The chapter's later problems repeatedly use continuity of $V$ and appropriate continuity conditions on $\mathbf{D}$ at dielectric interfaces to complete piecewise boundary-value solutions.

## Page-Grounded Details

#### Page 176

different potential values and different spatial rates of change, yet for each of them $\nabla^{2}V=0$. Because every field (if $\rho_{v}=0$) satisfies Laplace's equation, how can we expect to reverse the procedure and use Laplace's equation to find one specific field in which we happen to have an interest? Obviously, more information is required, and we will find that Laplace's equation must be solved subject to certain boundary conditions.

Every physical problem must contain at least one conducting boundary and usually contains two or more. The potentials on these boundaries are assigned values, perhaps $V_{0}$, $V_{1}$, $\ldots$, or perhaps numerical values. These definite equipotential surfaces will provide the boundary conditions for the type of problem to be solved. In other types of problems, the boundary conditions take the form of specified values of $E$ (alternatively, a surface charge density, $\rho_{S}$) on an enclosing surface, or a mixture of known values of $V$ and $E$.

Before using Laplace's equation or Poisson's equation in several examples, it must be stated that if our answer satisfies Laplace's equation and also satisfies the boundary conditi

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

- Laplace's equation requires boundary information to select one physical field.
- Conductors provide fixed-potential equipotential boundaries.
- Boundary data may specify $V$, $E$, $\rho_S$, or a mixture.
- A solution satisfying the equation and boundary conditions is unique.
- The theorem supports verification of proposed potential functions.
- Composite dielectric problems require interface continuity conditions.

## Source Anchors

- The text states that all fields with $\rho_v=0$ satisfy Laplace's equation but have different potential values and spatial variations.
- Physical problems contain at least one conducting boundary and usually two or more.
- Specified $E$ or $\rho_S$ on an enclosing surface is identified as an alternative boundary condition.
- The Uniqueness Theorem is stated on Page 176.
- Problem 6.33 tests sums, differences, offsets, and products of two functions against both Laplace's equation and the original boundary values.
- Problems 6.31, 6.34, and 6.43 require piecewise solutions and interface continuity.

## Related Pages

- [[laplaces-equation-in-three-coordinate-systems|Laplace's Equation in Three Coordinate Systems]]
- [[direct-integration-of-one-dimensional-laplace-problems|Direct Integration of One-Dimensional Laplace Problems]]
- [[laplace-and-poisson-boundary-value-problem-family|Laplace and Poisson Boundary-Value Problem Family]]

## Concept Dependencies

- applies-to: [[laplaces-equation-in-three-coordinate-systems|Laplace's Equation in Three Coordinate Systems]]
