---
title: "1.92 Direct Integration of One-Dimensional Laplace Problems"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 176", "Page 177", "Page 178"]
related: ["laplaces-equation-in-three-coordinate-systems", "potential-to-charge-capacitance-workflow", "cylindrical-one-dimensional-potential-solutions", "spherical-one-dimensional-potential-solutions", "boundary-conditions-and-the-uniqueness-theorem"]
---

# 1.92 Direct Integration of One-Dimensional Laplace Problems

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 176, Page 177, Page 178

Direct integration solves Laplace problems in which the potential depends on only one coordinate. Coordinate symmetry reduces the full partial differential equation to an ordinary differential equation. Although three coordinate systems might appear to produce nine single-coordinate cases, rotations and equivalent geometries reduce them to five distinct problems: one rectangular, two cylindrical, and two spherical. For $V=V(x)$, Laplace's equation becomes $d^2V/dx^2=0$, which integrates to
$$
V=Ax+B
$$
 The two integration constants are fixed by two boundary conditions, as expected for a second-order differential equation. Surfaces of constant $x$ are parallel planes, so this solution represents a parallel-plate geometry. With $V=0$ at $x=0$ and $V=V_0$ at $x=d$, the potential is
$$
V=\frac{V_0x}{d}
$$
 The electric field is uniform and directed opposite increasing potential:
$$
\mathbf{E}=-\frac{V_0}{d}\mathbf{a}_x
$$
 This example establishes the general pattern of symmetry reduction, integration, application of boundary values, and physical interpretation of constant-coordinate surfaces.

## Page-Grounded Details

#### Page 176

different potential values and different spatial rates of change, yet for each of them $\nabla^{2}V=0$. Because every field (if $\rho_{v}=0$) satisfies Laplace's equation, how can we expect to reverse the procedure and use Laplace's equation to find one specific field in which we happen to have an interest? Obviously, more information is required, and we will find that Laplace's equation must be solved subject to certain boundary conditions.

Every physical problem must contain at least one conducting boundary and usually contains two or more. The potentials on these boundaries are assigned values, perhaps $V_{0}$, $V_{1}$, $\ldots$, or perhaps numerical values. These definite equipotential surfaces will provide the boundary conditions for the type of problem to be solved. In other types of problems, the boundary conditions take the form of specified values of $E$ (alternatively, a surface charge density, $\rho_{S}$) on an enclosing surface, or a mixture of known values of $V$ and $E$.

Before using Laplace's equation or Poisson's equation in several examples, it must be stated that if our answer satisfies Laplace's equation and also satisfies the boundary conditi

[Truncated for analysis]

#### Page 177

and the partial derivative may be replaced by an ordinary derivative, since V is not a function of y or z,
$$
\frac{d^{2}V}{dx^{2}}=0
$$
We integrate twice, obtaining
$$
\frac{dV}{dx}=A
$$
and
$$
V=Ax+B\quad{(31)}
$$
where A and B are constants of integration. Equation (31) contains two such constants, as we would expect for a second-order differential equation. These constants can be determined only from the boundary conditions.

Since the field varies only with x and is not a function of y and z, then V is a constant if x is a constant or, in other words, the equipotential surfaces are parallel planes normal to the x axis. The field is thus that of a parallel-plate capacitor, and as soon as we specify the potential on any two planes, we may evaluate our constants of integration.

#### Example 6.2

Start with the potential function, Eq. (31), and find the capacitance of a parallel-plate capacitor of plate area S, plate separation d, and potential difference $V_{0}$ between plates.

Solution. Take V= 0 at x= 0 and $V=V_{0}$ at x=d. Then from Eq. (31),
$$
A=\frac{V_{0}}{d}\quad B=0
$$
and
$$
V=\frac{V_{0}x}{d}\quad{(32)}
$$
We still need the total charge on either plat

[Truncated for analysis]

#### Page 178

Here we have
$$
V=V_{0}\frac{x}{d}
$$
$$
E=-\frac{V_{0}}{d}a_{x}
$$
$$
D=-\epsilon\frac{V_{0}}{d}a_{x}
$$
$$
D_{S}=\left.D\right|_{x=0}=-\epsilon\frac{V_{0}}{d}a_{x}
$$
$$
a_{N}=a_{x}
$$
$$
D_{N}=-\epsilon\frac{V_{0}}{d}=\rho_{S}
$$
$$
Q=\int_{S}\frac{-\epsilon\,V_{0}}{d}dS=-\epsilon\frac{V_{0}S}{d}
$$
and the capacitance is
$$
C=\frac{|Q|}{V_{0}}=\frac{\epsilon S}{d}
$$
(33)

We will use this procedure several times in the examples to follow.

#### Example 6.3

Because no new problems are solved by choosing fields which vary only with y or with z in rectangular coordinates, we pass on to cylindrical coordinates for our next example. Variations with respect to z are again nothing new, and we next assume variation with respect to $\rho$ only. Laplace's equation becomes
$$
\frac{1}{\rho}\frac{\partial}{\partial\rho}\left(\rho\frac{\partial V}{\partial\rho}\right)=0
$$
Noting the $\rho$ in the denominator, we exclude $\rho=0$ from our solution and then multiply by $\rho$ and integrate,
$$
\rho\frac{dV}{d\rho}=A
$$
where a total derivative replaces the partial derivative because V varies only with $\rho$. Next, rearrange, and integrate again,
$$
V=A\ln\rho+B
$$
[Truncated for analysis]

## Core Ideas

- Direct integration requires $V$ to depend on only one coordinate.
- Symmetry reduces the PDE to an ODE.
- There are five distinct one-dimensional cases across the three coordinate systems.
- A second-order equation produces two integration constants.
- Boundary conditions determine both constants.
- For parallel planes, $V=V_0x/d$.
- The resulting parallel-plate electric field is uniform.

## Source Anchors

- Section 6.7 identifies direct integration as the simplest method.
- The source counts one rectangular, two cylindrical, and two spherical cases.
- Equation (31) gives $V=Ax+B$.
- Equation (32) gives $V=V_0x/d$.
- Constant-$x$ surfaces are identified as parallel equipotential planes normal to the $x$ axis.
- Example 6.2 interprets this as a parallel-plate capacitor.

## Related Pages

- [[laplaces-equation-in-three-coordinate-systems|Laplace's Equation in Three Coordinate Systems]]
- [[potential-to-charge-capacitance-workflow|Potential-to-Charge Capacitance Workflow]]
- [[cylindrical-one-dimensional-potential-solutions|Cylindrical One-Dimensional Potential Solutions]]
- [[spherical-one-dimensional-potential-solutions|Spherical One-Dimensional Potential Solutions]]
- [[boundary-conditions-and-the-uniqueness-theorem|Boundary Conditions and the Uniqueness Theorem]]

## Concept Dependencies

- applies-to: [[laplaces-equation-in-three-coordinate-systems|Laplace's Equation in Three Coordinate Systems]]
- depends-on: [[boundary-conditions-and-the-uniqueness-theorem|Boundary Conditions and the Uniqueness Theorem]]
