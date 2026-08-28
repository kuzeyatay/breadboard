---
title: "Derivation of Poisson's Equation"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "derivation-of-poissons-equation"
locations: ["Page 174", "Page 175", "Page 176"]
related: ["laplaces-equation-in-three-coordinate-systems", "boundary-conditions-and-the-uniqueness-theorem", "one-dimensional-poisson-solution-for-a-pn-junction"]
---

## ConceptNode: Derivation of Poisson's Equation

Planning node for [[derivation-of-poissons-equation|1.89 Derivation of Poisson's Equation]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 174, Page 175, Page 176

Poisson's equation provides the potential field when volume charge density may be present. It follows directly from three electrostatic relations: Gauss's law in point form, $\nabla\cdot\mathbf{D}=\rho_v$; the constitutive relation, $\mathbf{D}=\epsilon\mathbf{E}$; and the potential-gradient relation, $\mathbf{E}=-\nabla V$. Substitution gives $$\nabla\cdot(\epsilon\mathbf{E})=-\nabla\cdot(\epsilon\nabla V)=\rho_v.$$ In a homogeneous region where $\epsilon$ is constant, this becomes $$\nabla^2V=-\frac{\rho_v}{\epsilon}.$$ The operator $\nabla^2=\nabla\cdot\nabla$ is the Laplacian. In rectangular coordinates it expands into the sum of three second partial derivatives: $$\nabla^2V=\frac{\partial^2V}{\partial x^2}+\frac{\partial^2V}{\partial y^2}+\frac{\partial^2V}{\partial z^2}.$$ This equation reverses the usual charge-first electrostatic calculation. Instead of assuming conductor charge and finding voltage, one can begin with known boundary potentials and a specified volume charge density, solve for $V$, and then recover the electric field and charge.

### Key planning details

- Poisson's equation combines Gauss's law, $\mathbf{D}=\epsilon\mathbf{E}$, and $\mathbf{E}=-\nabla V$.
- Constant permittivity is required for the displayed form $\nabla^2V=-\rho_v/\epsilon$.
- $\nabla^2$ denotes the Laplacian operator.
- The rectangular Laplacian is the sum of second derivatives with respect to $x$, $y$, and $z$.
- The equation supports problems with known boundary potentials and volume charge.
- After finding $V$, the field follows from $\mathbf{E}=-\nabla V$.

### Source coverage

- Equation (21) states $\nabla\cdot\mathbf{D}=\rho_v$.
- Equation (22) states $\mathbf{D}=\epsilon\mathbf{E}$.
- Equation (23) states $\mathbf{E}=-\nabla V$.
- Equation (24) gives $\nabla\cdot\nabla V=-\rho_v/\epsilon$ for homogeneous $\epsilon$.
- Equation (26) expands Poisson's equation in rectangular coordinates.
- Problem D6.5 asks for $V$ and $\rho_v$ from specified potential functions in three coordinate systems.
