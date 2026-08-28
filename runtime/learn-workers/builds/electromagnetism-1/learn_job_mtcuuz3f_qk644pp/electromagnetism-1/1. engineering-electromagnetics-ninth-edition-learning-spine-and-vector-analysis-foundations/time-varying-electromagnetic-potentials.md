---
title: "1.153 Time-Varying Electromagnetic Potentials"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 307", "Page 308", "Section 9.5: The Retarded Potentials"]
related: ["static-scalar-and-vector-potentials", "lorenz-gauge-and-potential-wave-equations", "potential-and-duality-problems"]
---

# 1.153 Time-Varying Electromagnetic Potentials

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 307, Page 308, Section 9.5: The Retarded Potentials

The magnetic relation $\mathbf{B}=\nabla\times\mathbf{A}$ remains compatible with $\nabla\cdot\mathbf{B}=0$ because the divergence of any curl is identically zero. The static electric relation $\mathbf{E}=-\nabla V$ is not sufficient for time-varying fields because its curl is zero, contradicting Faraday's law when $\partial\mathbf{B}/\partial t\ne0$. Introducing an additional term $\mathbf{N}$ gives $\mathbf{E}=-\nabla V+\mathbf{N}$. Taking the curl and using Faraday's law together with $\mathbf{B}=\nabla\times\mathbf{A}$ yields $\nabla\times\mathbf{N}=-\nabla\times(\partial\mathbf{A}/\partial t)$. The simplest choice is $\mathbf{N}=-\partial\mathbf{A}/\partial t$, which produces
$$
\mathbf{E}=-\nabla V-\frac{\partial\mathbf{A}}{\partial t}
$$
 The first term represents the scalar-potential contribution, while the second accounts for electric fields induced by changing magnetic potential.

## Page-Grounded Details

#### Page 307

Equation (50) apparently is still consistent with Maxwell's equations. These equations state that $\nabla\cdot B=0$, and the divergence of (50) leads to the divergence of the curl that is identically zero. We will therefore tentatively accept (50) as satisfac-tory for time-varying fields and turn our attention to (49).

The inadequacy of (49) is obvious because application of the curl operation to each side and recognition of the curl of the gradient as being identically zero confront us with $\nabla\times E=0$. However, the point form of Faraday's law states that $\nabla\times E$ is not generally zero, so we may effect an improvement by adding an unknown term to (49),
$$
E=-\nabla V+N
$$
taking the curl,
$$
\nabla\times E=0+\nabla\times N
$$
using the point form of Faraday's law,
$$
\nabla\times N=-\frac{\partial B}{\partial t}
$$
and using (50), giving us
$$
\nabla\times N=-\frac{\partial}{\partial t}(\nabla\times A)
$$
or
$$
\nabla\times N=-\nabla\times\frac{\partial A}{\partial t}
$$
The simplest solution of this equation is
$$
N=-\frac{\partial A}{\partial t}
$$
and this leads to
$$
E=-\nabla V-\frac{\partial A}{\partial t}\quad{(51)}
$$
We still must check

[Truncated for analysis]

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

## Core Ideas

- $\mathbf{B}=\nabla\times\mathbf{A}$ automatically satisfies $\nabla\cdot\mathbf{B}=0$.
- $\mathbf{E}=-\nabla V$ alone incorrectly forces $\nabla\times\mathbf{E}=0$.
- Faraday's law requires an additional time-dependent vector-potential term.
- The time-varying electric field is $\mathbf{E}=-\nabla V-\partial\mathbf{A}/\partial t$.
- The derivation uses the identities for the curl of a gradient and the divergence of a curl.

## Source Anchors

- Page 307 tests Equation (50) against $\nabla\cdot\mathbf{B}=0$.
- Page 307 introduces $\mathbf{E}=-\nabla V+\mathbf{N}$ after identifying the failure of the static relation.
- Equation (51) gives $\mathbf{E}=-\nabla V-\partial\mathbf{A}/\partial t$.
- Page 307 substitutes the potential definitions into Ampère's law and Gauss's law to continue the consistency check.

## Related Pages

- [[static-scalar-and-vector-potentials|Static Scalar and Vector Potentials]]
- [[lorenz-gauge-and-potential-wave-equations|Lorenz Gauge and Potential Wave Equations]]
- [[potential-and-duality-problems|Potential and Duality Problems]]

## Concept Dependencies

- depends-on: [[static-scalar-and-vector-potentials|Static Scalar and Vector Potentials]]
