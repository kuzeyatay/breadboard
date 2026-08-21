---
title: "Cylindrical One-Dimensional Potential Solutions"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "cylindrical-one-dimensional-potential-solutions"
locations: ["Page 178", "Page 179", "Page 180", "Page 182"]
related: ["direct-integration-of-one-dimensional-laplace-problems", "potential-to-charge-capacitance-workflow", "spherical-one-dimensional-potential-solutions", "capacitor-geometry-and-dielectric-design-problems"]
---

## ConceptNode: Cylindrical One-Dimensional Potential Solutions

Planning node for [[cylindrical-one-dimensional-potential-solutions|1.94 Cylindrical One-Dimensional Potential Solutions]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 178, Page 179, Page 180, Page 182

Cylindrical coordinates produce two distinct one-dimensional Laplace solutions. For radial variation $V=V(\rho)$, Laplace's equation reduces to $$\frac{1}{\rho}\frac{d}{d\rho}\left(\rho\frac{dV}{d\rho}\right)=0.$$ Excluding $\rho=0$ and integrating twice gives $V=A\ln\rho+B$. For coaxial conductors with $V=V_0$ at $\rho=a$ and $V=0$ at $\rho=b$, $$V=V_0\frac{\ln(b/\rho)}{\ln(b/a)}.$$ The resulting capacitance is $$C=\frac{2\pi\epsilon L}{\ln(b/a)}.$$ For angular variation $V=V(\phi)$, Laplace's equation reduces to $d^2V/d\phi^2=0$. Radial conducting planes at $φ=0$ and $φ=\alpha$ with potentials 0 and $V_0$ produce $$V=V_0\frac{\phi}{\alpha},$$ and $$\mathbf{E}=-\frac{V_0}{\alpha\rho}\mathbf{a}_\phi.$$ Although the potential depends only on $\phi$, the field magnitude depends on $\rho$ because the cylindrical gradient contains the scale factor $1/\rho$.

### Key planning details

- Radial cylindrical symmetry produces a logarithmic potential.
- The coaxial solution excludes the singular axis $\rho=0$.
- Coaxial equipotential surfaces are cylinders.
- The coaxial capacitance is $2\pi\epsilon L/\ln(b/a)$.
- Angular cylindrical symmetry produces a linear function of $\phi$.
- Constant-$\phi$ equipotential surfaces are radial planes.
- For radial planes, the field is directed along $\mathbf{a}_\phi$ and varies as $1/\rho$.

### Source coverage

- Equation (34) gives $V=A\ln\rho+B$.
- Equation (35) gives the bounded coaxial potential.
- Equation (36) gives $C=2\pi\epsilon L/\ln(b/a)$.
- S1.P179.F1, Figure 6.10 shows two infinite radial planes separated by angle $\alpha$.
- Equation (37) gives $V=V_0\phi/\alpha$.
- Equation (38) gives $\mathbf{E}=-V_0\mathbf{a}_\phi/(\alpha\rho)$.
- Problem D6.6 asks for field magnitudes in both coaxial-cylinder and radial-plane geometries.
