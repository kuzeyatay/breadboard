---
title: "1.90 Laplace's Equation in Three Coordinate Systems"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 175", "Page 176"]
related: ["derivation-of-poissons-equation", "boundary-conditions-and-the-uniqueness-theorem", "direct-integration-of-one-dimensional-laplace-problems"]
---

# 1.90 Laplace's Equation in Three Coordinate Systems

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 175, Page 176

Laplace's equation is the charge-free specialization of Poisson's equation. When $\rho_v=0$ throughout a region,
$$
\nabla^2V=0
$$
 Point, line, and surface charges may still occur at singular locations or boundaries, but there is no distributed volume charge in the region where the equation is applied. In rectangular coordinates, the equation is
$$
\frac{\partial^2V}{\partial x^2}+\frac{\partial^2V}{\partial y^2}+\frac{\partial^2V}{\partial z^2}=0
$$
 In cylindrical coordinates, it is
$$
\frac{1}{\rho}\frac{\partial}{\partial\rho}\left(\rho\frac{\partial V}{\partial\rho}\right)+\frac{1}{\rho^2}\frac{\partial^2V}{\partial\phi^2}+\frac{\partial^2V}{\partial z^2}=0
$$
 In spherical coordinates, it is
$$
\frac{1}{r^2}\frac{\partial}{\partial r}\left(r^2\frac{\partial V}{\partial r}\right)+\frac{1}{r^2\sin\theta}\frac{\partial}{\partial\theta}\left(\sin\theta\frac{\partial V}{\partial\theta}\right)+\frac{1}{r^2\sin^2\theta}\frac{\partial^2V}{\partial\phi^2}=0
$$
 The unexpanded cylindrical and spherical forms preserve the geometric factors needed for correct differentiation.

## Page-Grounded Details

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

- Laplace's equation applies where $\rho_v=0$.
- Boundary or singular point, line, and surface charges may still source the field.
- The Laplacian has coordinate-dependent geometric factors.
- Rectangular coordinates use a direct sum of three second derivatives.
- Cylindrical coordinates contain $1/\rho$ and $1/\rho^2$ factors.
- Spherical coordinates contain $r^2$ and $\sin\theta$ factors.
- The source recommends retaining the compact divergence-gradient forms.

## Source Anchors

- Equation (27) states $\nabla^2V=0$.
- Equation (28) gives the rectangular-coordinate form.
- Equation (29) gives the cylindrical-coordinate Laplacian.
- Equation (30) gives the spherical-coordinate Laplacian.
- The text explicitly allows singular point, line, and surface charge sources when the regional volume charge density is zero.
- The compact coordinate forms are described as easier to expand than to reconstruct.

## Related Pages

- [[derivation-of-poissons-equation|Derivation of Poisson's Equation]]
- [[boundary-conditions-and-the-uniqueness-theorem|Boundary Conditions and the Uniqueness Theorem]]
- [[direct-integration-of-one-dimensional-laplace-problems|Direct Integration of One-Dimensional Laplace Problems]]

## Concept Dependencies

- derives-from: [[derivation-of-poissons-equation|Derivation of Poisson's Equation]]
