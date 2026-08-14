---
title: "1.154 Lorenz Gauge and Potential Wave Equations"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 308", "Page 309", "Section 9.5: The Retarded Potentials"]
related: ["time-varying-electromagnetic-potentials", "retarded-scalar-and-vector-potentials", "potential-and-duality-problems", "lossless-traveling-wave-solutions", "static-scalar-and-vector-potentials"]
---

# 1.154 Lorenz Gauge and Potential Wave Equations

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 308, Page 309, Section 9.5: The Retarded Potentials

Specifying only the curl of a vector potential does not determine the potential uniquely. For example, if only $A_x$ is nonzero, the magnetic field determines the derivatives of $A_x$ with respect to $y$ and $z$ but gives no information about its variation with $x$. The missing information can be supplied by specifying $\nabla\cdot\mathbf{A}$ and fixing the potential at one point, commonly by requiring it to vanish at infinity. The source chooses the Lorenz gauge
$$
\nabla\cdot\mathbf{A}=-\mu\epsilon\frac{\partial V}{\partial t}
$$
 Substitution into the coupled potential equations removes mixed scalar-vector terms and produces symmetric inhomogeneous wave equations:
$$
\nabla^2\mathbf{A}=-\mu\mathbf{J}+\mu\epsilon\frac{\partial^2\mathbf{A}}{\partial t^2}
$$
$$
\nabla^2V=-\frac{\rho_v}{\epsilon}+\mu\epsilon\frac{\partial^2V}{\partial t^2}
$$
 Under static or dc conditions, these reduce to the corresponding Poisson equations.

## Page-Grounded Details

#### Page 308

and
$$
\nabla^{2}V+\frac{\partial}{\partial t}(\nabla\cdot\mathbf{A})=-\frac{\rho_{v}}{\epsilon}\qquad(53)
$$
There is no apparent inconsistency in (52) and (53). Under static or dc conditions $\nabla\cdot\mathbf{A}=0$, and (52) and (53) reduce to (48) and (47), respectively. We will therefore assume that the time-varying potentials may be defined in such a way that $\mathbf{B}$ and $\mathbf{E}$ may be obtained from them through (50) and (51). These latter two equations do not serve, however, to define $\mathbf{A}$ and $V$ completely. They represent necessary, but not sufficient, conditions. Our initial assumption was merely that $\mathbf{B}=\nabla\times\mathbf{A}$, and a vector cannot be defined by giving its curl alone. Suppose, for example, that we have a very simple vector potential field in which $A_{y}$ and $A_{z}$ are zero. Expansion of (50) leads to
$$
\begin{split}B_{x}&=0\\ B_{y}&=\frac{\partial A_{x}}{\partial z}\\ B_{z}&=-\frac{\partial A_{x}}{\partial y}\end{split}
$$
and we see that no information is available about the manner in which $A_{x}$ varies with $x$. This information could be found if we also knew the value of the divergence of $ \mat

[Truncated for analysis]

#### Page 309

pleased with our definitions of $V$ and $A$,
$$
B=\nabla\times A \quad{(50)}
$$
$$
\nabla\cdot A=-\mu e\frac{\partial V}{\partial t} \quad{(54)}
$$
$$
E=-\nabla V-\frac{\partial A}{\partial t} \quad{(51)}
$$
The integral equivalents of (45) and (46) for the time-varying potentials follow from the definitions (50), (51), and (54), but we shall merely present the final results and indicate their general nature. In Chapter 11, we will find that any electromagnetic disturbance will travel at a velocity
$$
v=\frac{1}{\sqrt{\mu e}}
$$
through any homogeneous medium described by $\mu$ and $\epsilon$. In the case of free space, this velocity turns out to be the velocity of light, approximately $3\times 10^{8}$ m/s. It is logical, then, to suspect that the potential at any point is due not to the value of the charge density at some distant point at the same instant, but to its value at some previous time, because the effect propagates at a finite velocity. Thus (45) becomes
$$
V=\int_{\rm vol}\frac{[\rho_{v}]}{4\pi\epsilon R}dv \quad{(57)}
$$
where $[\rho_{v}]$ indicates that every $t$ appearing in the expression for $\rho_{v}$ has been replaced by a retarded time,

[Truncated for analysis]

## Core Ideas

- A vector field requires curl, divergence, and a value at one point for complete specification.
- A potential constant is set to zero when fields must vanish at infinity.
- The Lorenz gauge is $\nabla\cdot\mathbf{A}=-\mu\epsilon\,\partial V/\partial t$.
- The gauge decouples the scalar and vector potential equations.
- The resulting equations have the structure of driven wave equations.

## Source Anchors

- Page 308 uses an $A_x$-only example to show that curl information does not determine variation with $x$.
- Equation (54) defines $\nabla\cdot\mathbf{A}=-\mu\epsilon\,\partial V/\partial t$.
- Equations (55) and (56) give the vector and scalar potential wave equations.
- Pages 308 and 309 summarize the definitions $\mathbf{B}=\nabla\times\mathbf{A}$, the gauge condition, and $\mathbf{E}=-\nabla V-\partial\mathbf{A}/\partial t$.

## Related Pages

- [[time-varying-electromagnetic-potentials|Time-Varying Electromagnetic Potentials]]
- [[retarded-scalar-and-vector-potentials|Retarded Scalar and Vector Potentials]]
- [[potential-and-duality-problems|Potential and Duality Problems]]
- [[lossless-traveling-wave-solutions|Lossless Traveling-Wave Solutions]]
- [[static-scalar-and-vector-potentials|Static Scalar and Vector Potentials]]

## Concept Dependencies

- depends-on: [[time-varying-electromagnetic-potentials|Time-Varying Electromagnetic Potentials]]
- contrasts-with: [[static-scalar-and-vector-potentials|Static Scalar and Vector Potentials]]
