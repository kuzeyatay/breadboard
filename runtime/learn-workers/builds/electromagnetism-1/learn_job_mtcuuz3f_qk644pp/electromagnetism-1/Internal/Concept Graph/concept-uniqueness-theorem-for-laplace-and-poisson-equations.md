---
title: "Uniqueness Theorem for Laplace and Poisson Equations"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "uniqueness-theorem-for-laplace-and-poisson-equations"
locations: ["Page 581, Appendix D", "Page 582, Appendix D"]
related: ["gradient-curl-and-laplacian-in-curvilinear-coordinates", "vector-identities-for-electromagnetic-analysis", "divergence-in-orthogonal-curvilinear-coordinates"]
---

## ConceptNode: Uniqueness Theorem for Laplace and Poisson Equations

Planning node for [[uniqueness-theorem-for-laplace-and-poisson-equations|1.350 Uniqueness Theorem for Laplace and Poisson Equations]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 581, Appendix D, Page 582, Appendix D

The uniqueness proof begins by assuming two solutions $V_1$ and $V_2$ of Laplace's equation that satisfy the same specified boundary potential $V_b$. Their difference $U=V_1-V_2$ obeys $\nabla^2U=0$ and vanishes on the boundary. Applying the identity $\nabla\cdot(U\nabla U)=U\nabla^2U+|\nabla U|^2$ and integrating over the enclosed volume produces two volume terms. The divergence theorem converts the left side to a closed surface integral. That surface integral is zero because $U=0$ on the boundary, while the term containing $U\nabla^2U$ is zero because $\nabla^2U=0$. Therefore $$\int_{\mathrm{vol}}|\nabla U|^2\,dv=0.$$ Since the integrand cannot be negative, it must vanish everywhere, so $\nabla U=0$. Hence $U$ is constant throughout the connected region. Its boundary value is zero, so the constant is zero and $V_1=V_2$. The same proof applies to Poisson's equation when both candidate solutions have the same charge density and boundary values, because subtracting their equations again gives Laplace's equation. The theorem ensures that any correctly obtained solution satisfying the governing equation and boundary conditions is the only solution.

### Key planning details

- Set $U=V_1-V_2$ for two candidate solutions.
- Equal Laplace equations imply $\nabla^2U=0$.
- Equal Dirichlet boundary values imply $U=0$ on the boundary.
- Use $\nabla\cdot(U\nabla U)=U\nabla^2U+|\nabla U|^2$.
- The divergence theorem turns the divergence volume integral into a boundary integral.
- Nonnegativity of $|\nabla U|^2$ forces $\nabla U=0$ everywhere.
- A zero boundary value makes the resulting constant zero.
- The argument extends to Poisson's equation with the same source density.

### Source coverage

- Page 581 assumes $\nabla^2V_1=0$ and $\nabla^2V_2=0$, hence $\nabla^2(V_1-V_2)=0$.
- The boundary conditions give $V_{1b}=V_{2b}=V_b$.
- Equation (D.1) integrates the divergence identity over the volume.
- Page 582 uses the divergence theorem and the zero boundary difference to make the surface integral vanish.
- The remaining integral is $\int_{\mathrm{vol}}[\nabla(V_1-V_2)]^2dv=0$.
- The proof concludes $V_1-V_2=\mathrm{constant}=0$.
- The text extends the proof to $\nabla^2V=-\rho_v/\epsilon$.
