---
title: "One-Dimensional Poisson Solution for a pn Junction"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "one-dimensional-poisson-solution-for-a-pn-junction"
locations: ["Page 183", "Page 184", "Page 185"]
related: ["derivation-of-poissons-equation", "pn-junction-voltage-and-differential-capacitance", "laplace-and-poisson-boundary-value-problem-family"]
---

## ConceptNode: One-Dimensional Poisson Solution for a pn Junction

Planning node for [[one-dimensional-poisson-solution-for-a-pn-junction|1.96 One-Dimensional Poisson Solution for a pn Junction]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 183, Page 184, Page 185

The pn-junction example applies Poisson's equation to a specified smooth approximation of depletion-region charge. The p-type material occupies $x<0$ and the n-type material occupies $x>0$, with equal doping magnitudes. Hole and electron diffusion creates negative charge on the p side, positive charge on the n side, and an electric field directed toward negative $x$. The assumed charge density is $$\rho_v=2\rho_{v0}\operatorname{sech}\left(\frac{x}{a}\right)\tanh\left(\frac{x}{a}\right),$$ where the maximum magnitude is $\rho_{v0}$ at $x=0.881a$. Equal donor and acceptor concentrations give $\rho_{v0}=eN_a=eN_d$. With no $y$ or $z$ variation, Poisson's equation becomes an ordinary differential equation. Integrating once and imposing $E_x\to0$ as $x\to\pm\infty$ gives $$E_x=-\frac{2\rho_{v0}a}{\epsilon}\operatorname{sech}\left(\frac{x}{a}\right).$$ A second integration, with $V=0$ at $x=0$, gives the antisymmetric junction potential in Equation (46).

### Key planning details

- The p region is at $x<0$ and the n region is at $x>0$.
- Diffusion leaves negative charge on the p side and positive charge on the n side.
- The built-in electric field points toward negative $x$.
- The charge profile uses a product of $\operatorname{sech}(x/a)$ and $\tanh(x/a)$.
- Equal doping gives $\rho_{v0}=eN_a=eN_d$.
- The far-field condition forces the first integration constant to zero.
- The potential reference is chosen at the junction center.

### Source coverage

- Equation (44) specifies the smooth volume-charge profile.
- The maximum charge density occurs at $x=0.881a$.
- S1.P184.F1, Figure 6.12(a) plots negative charge on the p side and positive charge on the n side.
- S1.P184.F2, Figure 6.12(b) plots the negative electric field.
- Equation (45) gives the electric field profile.
- Equation (46) gives $$V=\frac{4\rho_{v0}a^2}{\epsilon}\left(\tan^{-1}e^{x/a}-\frac{\pi}{4}\right).$$
- S1.P184.F3, Figure 6.12(c) plots the potential across the junction.
