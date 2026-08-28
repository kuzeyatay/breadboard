---
title: "1.350 Uniqueness Theorem for Laplace and Poisson Equations"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 581, Appendix D", "Page 582, Appendix D"]
related: ["gradient-curl-and-laplacian-in-curvilinear-coordinates", "vector-identities-for-electromagnetic-analysis", "divergence-in-orthogonal-curvilinear-coordinates"]
---

# 1.350 Uniqueness Theorem for Laplace and Poisson Equations

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 581, Appendix D, Page 582, Appendix D

The uniqueness proof begins by assuming two solutions $V_1$ and $V_2$ of Laplace's equation that satisfy the same specified boundary potential $V_b$. Their difference $U=V_1-V_2$ obeys $\nabla^2U=0$ and vanishes on the boundary. Applying the identity $\nabla\cdot(U\nabla U)=U\nabla^2U+|\nabla U|^2$ and integrating over the enclosed volume produces two volume terms. The divergence theorem converts the left side to a closed surface integral. That surface integral is zero because $U=0$ on the boundary, while the term containing $U\nabla^2U$ is zero because $\nabla^2U=0$. Therefore
$$
\int_{\mathrm{vol}}|\nabla U|^2\,dv=0
$$
 Since the integrand cannot be negative, it must vanish everywhere, so $\nabla U=0$. Hence $U$ is constant throughout the connected region. Its boundary value is zero, so the constant is zero and $V_1=V_2$. The same proof applies to Poisson's equation when both candidate solutions have the same charge density and boundary values, because subtracting their equations again gives Laplace's equation. The theorem ensures that any correctly obtained solution satisfying the governing equation and boundary conditions is the only solution.

## Page-Grounded Details

#### Page 581

### The Uniqueness Theorem

Let us assume that we have two solutions of Laplace's equation, $V_{1}$ and $V_{2}$, both general functions of the coordinates used. Therefore
$$
\nabla^{2}V_{1}=0
$$
and
$$
\nabla^{2}V_{2}=0
$$
from which
$$
\nabla^{2}(V_{1}-V_{2})=0
$$
Each solution must also satisfy the boundary conditions, and if we represent the given potential values on the boundaries by $V_{b}$, then the value of $V_{1}$ on the boundary $V_{1b}$ and the value of $V_{2}$ on the boundary $V_{2b}$ must both be identical to $V_{b}$,
$$
V_{1b}=V_{2b}=V_{b}
$$
or
$$
V_{1b}-V_{2b}=0
$$
In Section 4.8, Eq. (43), we made use of a vector identity,
$$
\nabla\cdot(V\mathbf{D})\equiv V(\nabla\cdot\mathbf{D})+\mathbf{D}\cdot(\nabla V)
$$
which holds for any scalar $V$ and any vector $\mathbf{D}$. For the present application we shall select $V_{1}-V_{2}$ as the scalar and $\nabla(V_{1}-V_{2})$ as the vector, giving
$$
\begin{align*}\nabla\cdot[(V_{1}-V_{2})\nabla(V_{1}-V_{2})]&\equiv(V_{1}-V_{2})[\nabla\cdot\nabla(V_{1}-V_{2})]\\+&\nabla(V_{1}-V_{2})\cdot\nabla(V_{1}-V_{2})\end{align*}
$$
#### Page 582

which we shall integrate throughout the volume enclosed by the boundary surfaces specified:
$$
\begin{align*}&\int_{\mathrm{vol}}\nabla\cdot[(V_{1}-V_{2})\nabla(V_{1}-V_{2})]dv\\ &\equiv\int_{\mathrm{vol}}(V_{1}-V_{2})[\nabla\cdot\nabla(V_{1}-V_{2})]dv+\int_{\mathrm{vol}}[\nabla(V_{1}-V_{2})]^{2}dv\end{align*}\quad(D.1)
$$
The divergence theorem allows us to replace the volume integral on the left side of the equation with the closed surface integral over the surface surrounding the volume. This surface consists of the boundaries already specified on which $V_{1b}=V_{2b}$, and therefore
$$
\int_{\mathrm{vol}}\nabla\cdot[(V_{1}-V_{2})\nabla(V_{1}-V_{2})]dv=\oint_{S}[(V_{1b}-V_{2b})\nabla(V_{1b}-V_{2b})]\cdot d\mathbf{S}=0
$$
One of the factors of the first integral on the right side of (D.1) is $\nabla\cdot\nabla(V_{1}-V_{2})$, or $\nabla^{2}(V_{1}-V_{2})$, which is zero by hypothesis, and therefore that integral is zero. Hence the remaining volume integral must be zero:
$$
\int_{\mathrm{vol}}[\nabla(V_{1}-V_{2})]^{2}dv=0
$$
There are two reasons why an integral may be zero: either the integrand (the quantity under the integral sign) is everywhere zero, or the integrand

[Truncated for analysis]

## Core Ideas

- Set $U=V_1-V_2$ for two candidate solutions.
- Equal Laplace equations imply $\nabla^2U=0$.
- Equal Dirichlet boundary values imply $U=0$ on the boundary.
- Use $\nabla\cdot(U\nabla U)=U\nabla^2U+|\nabla U|^2$.
- The divergence theorem turns the divergence volume integral into a boundary integral.
- Nonnegativity of $|\nabla U|^2$ forces $\nabla U=0$ everywhere.
- A zero boundary value makes the resulting constant zero.
- The argument extends to Poisson's equation with the same source density.

## Source Anchors

- Page 581 assumes $\nabla^2V_1=0$ and $\nabla^2V_2=0$, hence $\nabla^2(V_1-V_2)=0$.
- The boundary conditions give $V_{1b}=V_{2b}=V_b$.
- Equation (D.1) integrates the divergence identity over the volume.
- Page 582 uses the divergence theorem and the zero boundary difference to make the surface integral vanish.
- The remaining integral is $\int_{\mathrm{vol}}[\nabla(V_1-V_2)]^2dv=0$.
- The proof concludes $V_1-V_2=\mathrm{constant}=0$.
- The text extends the proof to $\nabla^2V=-\rho_v/\epsilon$.

## Related Pages

- [[gradient-curl-and-laplacian-in-curvilinear-coordinates|Gradient, Curl, and Laplacian in Curvilinear Coordinates]]
- [[vector-identities-for-electromagnetic-analysis|Vector Identities for Electromagnetic Analysis]]
- [[divergence-in-orthogonal-curvilinear-coordinates|Divergence in Orthogonal Curvilinear Coordinates]]

## Concept Dependencies

- depends-on: [[vector-identities-for-electromagnetic-analysis|Vector Identities for Electromagnetic Analysis]]
- depends-on: [[gradient-curl-and-laplacian-in-curvilinear-coordinates|Gradient, Curl, and Laplacian in Curvilinear Coordinates]]
- depends-on: [[divergence-in-orthogonal-curvilinear-coordinates|Divergence in Orthogonal Curvilinear Coordinates]]
