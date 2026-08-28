---
title: "Free-Space Electromagnetic Wave Equation"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "free-space-electromagnetic-wave-equation"
locations: ["Page 382", "Page 383"]
related: ["uniform-plane-waves-from-sourceless-maxwell-equations", "traveling-wave-direction-and-sinusoidal-solutions", "vector-helmholtz-equation-in-free-space"]
---

## ConceptNode: Free-Space Electromagnetic Wave Equation

Planning node for [[free-space-electromagnetic-wave-equation|1.214 Free-Space Electromagnetic Wave Equation]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 382, Page 383

The coupled first-order Maxwell equations reduce to separate second-order wave equations for the electric and magnetic fields. With $E_x$ and $H_y$ varying only along $z$, the governing pair is $\partial E_x/\partial z=-\mu_0\partial H_y/\partial t$ and $\partial H_y/\partial z=-\epsilon_0\partial E_x/\partial t$. Differentiating the first equation with respect to $z$ and the second with respect to $t$ creates the same mixed derivative of $H_y$. Substitution eliminates the magnetic field and yields the electric-field wave equation. Reversing the elimination gives the identical form for $H_y$. Comparing the resulting equation with the standard one-dimensional wave equation identifies the propagation speed as $1/\sqrt{\mu_0\epsilon_0}$, which equals the free-space speed of light. This derivation shows that light speed is set by the electric and magnetic constitutive properties of free space. It also makes the mathematical analogy to the lossless telegraphist's equations explicit.

### Key planning details

- The first-order field equations couple spatial variation of one field to time variation of the other.
- Differentiation and substitution eliminate one field to obtain a second-order wave equation.
- The electric-field equation is $\partial^2E_x/\partial z^2=\mu_0\epsilon_0\partial^2E_x/\partial t^2$.
- The magnetic field satisfies the same wave-equation form.
- The free-space propagation speed is $v=1/\sqrt{\mu_0\epsilon_0}$.
- Numerically, $v=3\times10^8\,\mathrm{m/s}=c$.
- The derivation parallels the lossless transmission-line wave equation.

### Source coverage

- Equations (7) and (8) are $\frac{\partial E_x}{\partial z}=-\mu_0\frac{\partial H_y}{\partial t}$ and $\frac{\partial H_y}{\partial z}=-\epsilon_0\frac{\partial E_x}{\partial t}$.
- Equations (9) and (10) introduce compatible mixed derivatives by differentiating with respect to $z$ and $t$.
- Equation (11) is $\frac{\partial^2E_x}{\partial z^2}=\mu_0\epsilon_0\frac{\partial^2E_x}{\partial t^2}$.
- Equation (12) gives $v=1/\sqrt{\mu_0\epsilon_0}=3\times10^8\,\mathrm{m/s}=c$.
- Equation (13) gives $\frac{\partial^2H_y}{\partial z^2}=\mu_0\epsilon_0\frac{\partial^2H_y}{\partial t^2}$.
