---
title: "Streamline Differential Equations"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "streamline-differential-equations"
locations: ["Page 55", "Page 56", "Section: 2.6 Streamlines and Sketches of Fields"]
related: ["streamline-representation-of-electric-fields", "derivation-and-distance-scaling-of-the-infinite-line-field", "multipoles-finite-charge-distributions-and-far-field-limits"]
---

## ConceptNode: Streamline Differential Equations

Planning node for [[streamline-differential-equations|1.48 Streamline Differential Equations]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 55, Page 56, Section: 2.6 Streamlines and Sketches of Fields

For a two-dimensional field with $E_z=0$, a streamline has a tangent direction proportional to the local field vector. If a small displacement along the curve is $d\mathbf{l}=dx\mathbf{a}_x+dy\mathbf{a}_y$, matching its slope to the field components gives $dy/dx=E_y/E_x$. Substituting the functional forms of $E_x$ and $E_y$ produces a first-order differential equation whose solution is a family of streamlines. For a normalized infinite-line field, conversion from cylindrical to rectangular components gives $E_x=x/(x^2+y^2)$ and $E_y=y/(x^2+y^2)$. The common denominator cancels, leaving $dy/dx=y/x$, whose solution is $y=Cx$. A particular point determines the constant $C$. Thus the radial-line sketch is recovered analytically rather than inferred only by inspection.

### Key planning details

- A streamline's tangent is parallel to the local field.
- For a two-dimensional rectangular field, $dy/dx=E_y/E_x$.
- The field components determine a family of integral curves.
- A specified point selects one member of the family.
- For an infinite line charge, the streamline family is $y=Cx$.
- Equivalent streamline equations can be formulated in cylindrical or spherical coordinates.

### Source coverage

- Equation (19): $$\frac{E_y}{E_x}=\frac{dy}{dx}.$$
- Source figure S1.P55.F1, Figure 2.10, shows $E_x$, $E_y$, and the tangent to a streamline.
- For $\rho_L=2\pi\epsilon_0$, the field is $\mathbf{E}=\mathbf{a}_\rho/\rho$.
- In rectangular coordinates, $$\mathbf{E}=\frac{x}{x^2+y^2}\mathbf{a}_x+\frac{y}{x^2+y^2}\mathbf{a}_y.$$
- Integration gives $\ln y=\ln x+C_1$ and hence $y=Cx$.
- The streamline through $P(-2,7,10)$ has $C=-3.5$ and equation $y=-3.5x$.
- Drill D2.7 provides two additional fields whose streamline equations must be found.
