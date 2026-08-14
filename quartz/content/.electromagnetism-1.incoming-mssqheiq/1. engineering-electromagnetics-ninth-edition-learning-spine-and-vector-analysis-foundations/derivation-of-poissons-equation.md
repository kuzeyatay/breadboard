---
title: "1.89 Derivation of Poisson's Equation"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 174", "Page 175", "Page 176"]
related: ["laplaces-equation-in-three-coordinate-systems", "boundary-conditions-and-the-uniqueness-theorem", "one-dimensional-poisson-solution-for-a-pn-junction"]
---

# 1.89 Derivation of Poisson's Equation

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 174, Page 175, Page 176

Poisson's equation provides the potential field when volume charge density may be present. It follows directly from three electrostatic relations: Gauss's law in point form, $\nabla\cdot\mathbf{D}=\rho_v$; the constitutive relation, $\mathbf{D}=\epsilon\mathbf{E}$; and the potential-gradient relation, $\mathbf{E}=-\nabla V$. Substitution gives
$$
\nabla\cdot(\epsilon\mathbf{E})=-\nabla\cdot(\epsilon\nabla V)=\rho_v
$$
 In a homogeneous region where $\epsilon$ is constant, this becomes
$$
\nabla^2V=-\frac{\rho_v}{\epsilon}
$$
 The operator $\nabla^2=\nabla\cdot\nabla$ is the Laplacian. In rectangular coordinates it expands into the sum of three second partial derivatives:
$$
\nabla^2V=\frac{\partial^2V}{\partial x^2}+\frac{\partial^2V}{\partial y^2}+\frac{\partial^2V}{\partial z^2}
$$
 This equation reverses the usual charge-first electrostatic calculation. Instead of assuming conductor charge and finding voltage, one can begin with known boundary potentials and a specified volume charge density, solve for $V$, and then recover the electric field and charge.

## Page-Grounded Details

#### Page 174

#### 6.6 POISSON'S AND LAPLACE'S EQUATIONS

In preceding sections, we have found capacitance by first assuming a known charge distribution on the conductors and then finding the potential difference in terms of the assumed charge. An alternate approach would be to start with known potentials on each conductor, and then work backward to find the charge in terms of the known potential difference. The capacitance in either case is found by the ratio $Q/V$.

The first objective in the latter approach is thus to find the potential function between conductors, given values of potential on the boundaries, along with possible volume charge densities in the region of interest. The mathematical tools that enable this to happen are Poisson's and Laplace's equations, to be explored in the remainder of this chapter. Problems involving one to three dimensions can be solved either analytically or numerically. Laplace's and Poisson's equations, when compared to other methods, are probably the most widely useful because many problems in engineering practice involve devices in which applied potential differences are known, and in which constant potentials occur at the boundaries.

Obtaining Poisso

[Truncated for analysis]

#### Page 175

and therefore
$$
\begin{aligned}

\nabla\cdot\nabla V&=\frac{\partial}{\partial x}\left(\frac{\partial V}{\partial x}\right)+\frac{\partial}{\partial y}\left(\frac{\partial V}{\partial y}\right)+\frac{\partial}{\partial z}\left(\frac{\partial V}{\partial z}\right)\\

& =\frac{\partial^{2} V}{\partial x^{2}}+\frac{\partial^{2} V}{\partial y^{2}}+\frac{\partial^{2} V}{\partial z^{2}}

\end{aligned}
$$
Usually the operation $\nabla\cdot\nabla$ is abbreviated $\nabla^{2}$ (and pronounced "del squared"), a good reminder of the second-order partial derivatives appearing in Eq. (25), and so Poisson's equation becomes
$$
\nabla^{2}V=\frac{\partial^{2}V}{\partial x^{2}}+\frac{\partial^{2}V}{\partial y^{2}}+\frac{\partial^{2}V}{\partial z^{2}}=-\frac{\rho_{v}}{\epsilon}\quad{(26)}
$$
in rectangular coordinates.

If $\rho_{v}=0$, indicating zero volume charge density, but allowing point charges, line charge, and surface charge density to exist at singular locations as sources of the field, then
$$
\nabla^{2}V=0\quad{(27)}
$$
which is Laplace's equation. The $\nabla^{2}$ operation is called the Laplacian of V.

In rectangular coordinates Laplace's equation is
$$ \nabla^{2}V=\fra

[Truncated for analysis]

#### Page 176

different potential values and different spatial rates of change, yet for each of them $\nabla^{2}V=0$. Because every field (if $\rho_{v}=0$) satisfies Laplace's equation, how can we expect to reverse the procedure and use Laplace's equation to find one specific field in which we happen to have an interest? Obviously, more information is required, and we will find that Laplace's equation must be solved subject to certain boundary conditions.

Every physical problem must contain at least one conducting boundary and usually contains two or more. The potentials on these boundaries are assigned values, perhaps $V_{0}$, $V_{1}$, $\ldots$, or perhaps numerical values. These definite equipotential surfaces will provide the boundary conditions for the type of problem to be solved. In other types of problems, the boundary conditions take the form of specified values of $E$ (alternatively, a surface charge density, $\rho_{S}$) on an enclosing surface, or a mixture of known values of $V$ and $E$.

Before using Laplace's equation or Poisson's equation in several examples, it must be stated that if our answer satisfies Laplace's equation and also satisfies the boundary conditi

[Truncated for analysis]

## Core Ideas

- Poisson's equation combines Gauss's law, $\mathbf{D}=\epsilon\mathbf{E}$, and $\mathbf{E}=-\nabla V$.
- Constant permittivity is required for the displayed form $\nabla^2V=-\rho_v/\epsilon$.
- $\nabla^2$ denotes the Laplacian operator.
- The rectangular Laplacian is the sum of second derivatives with respect to $x$, $y$, and $z$.
- The equation supports problems with known boundary potentials and volume charge.
- After finding $V$, the field follows from $\mathbf{E}=-\nabla V$.

## Source Anchors

- Equation (21) states $\nabla\cdot\mathbf{D}=\rho_v$.
- Equation (22) states $\mathbf{D}=\epsilon\mathbf{E}$.
- Equation (23) states $\mathbf{E}=-\nabla V$.
- Equation (24) gives $\nabla\cdot\nabla V=-\rho_v/\epsilon$ for homogeneous $\epsilon$.
- Equation (26) expands Poisson's equation in rectangular coordinates.
- Problem D6.5 asks for $V$ and $\rho_v$ from specified potential functions in three coordinate systems.

## Related Pages

- [[laplaces-equation-in-three-coordinate-systems|Laplace's Equation in Three Coordinate Systems]]
- [[boundary-conditions-and-the-uniqueness-theorem|Boundary Conditions and the Uniqueness Theorem]]
- [[one-dimensional-poisson-solution-for-a-pn-junction|One-Dimensional Poisson Solution for a pn Junction]]

## Concept Dependencies

- enables: [[laplaces-equation-in-three-coordinate-systems|Laplace's Equation in Three Coordinate Systems]]
