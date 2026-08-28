---
title: "1.366 Differential Field Operators"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 605, Sections: Divergence, Gradient, Curl", "Page 606, Sections: Laplacian, Vector Laplacian"]
related: ["vector-analysis-and-electromagnetic-coordinate-systems", "electrostatic-fields-and-gausss-law", "electric-potential-energy-and-capacitance", "time-varying-fields-and-maxwells-equations", "uniform-plane-waves-and-material-propagation"]
---

# 1.366 Differential Field Operators

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 605, Sections: Divergence, Gradient, Curl, Page 606, Sections: Laplacian, Vector Laplacian

The reference pages collect the differential operators needed to convert between local field behavior and electromagnetic field laws. Divergence acts on a vector field such as electric flux density $\mathbf{D}$ and measures its local outward flux density. Gradient acts on a scalar potential $V$ and produces a vector pointing in the direction of greatest spatial increase. Curl acts on a vector field such as magnetic field intensity $\mathbf{H}$ and measures local circulation. The scalar Laplacian $\nabla^2V$ combines second spatial derivatives and is the operator appearing in Laplace's and Poisson's equations. Page 606 also distinguishes the vector Laplacian from simply writing one coordinate-independent scalar expression. In rectangular coordinates, the vector Laplacian is the componentwise scalar Laplacian. In cylindrical and spherical coordinates, additional component-coupling and geometric terms appear because the coordinate basis changes with position. These formulas form a reusable computational toolkit for applying Gauss's law, potential equations, Ampere's law, Faraday's law, and electromagnetic wave equations in geometries selected to match the physical symmetry.

## Page-Grounded Details

#### Page 605

#### DIVERGENCE

RECTANGULAR $\nabla\cdot\mathbf{D}=\frac{\partial D_{x}}{\partial x}+\frac{\partial D_{y}}{\partial y}+\frac{\partial D_{z}}{\partial z}$

CYLINDRICAL $\nabla\cdot\mathbf{D}=\frac{1}{\rho}\frac{\partial}{\partial\rho}(\rho\,D_{\rho})+\frac{1}{\rho}\frac{\partial D_{\phi}}{\partial\phi}+\frac{\partial D_{z}}{\partial z}$

SPHERICAL $\nabla\cdot\mathbf{D}=\frac{1}{r^{2}}\frac{\partial}{\partial r}(r^{2}D_{r})+\frac{1}{r\sin\theta}\frac{\partial}{\partial\theta}(D_{\theta}\sin\theta)+\frac{1}{r\sin\theta}\frac{\partial D_{\phi}}{\partial\phi}$

#### GRADIENT

RECTANGULAR $\nabla V=\frac{\partial V}{\partial x}\mathbf{a}_{x}+\frac{\partial V}{\partial y}\mathbf{a}_{y}+\frac{\partial V}{\partial z}\mathbf{a}_{z}$

CYLINDRICAL $\nabla V=\frac{\partial V}{\partial\rho}\mathbf{a}_{\rho}+\frac{1}{\rho}\frac{\partial V}{\partial\phi}\mathbf{a}_{\phi}+\frac{\partial V}{\partial z}\mathbf{a}_{z}$

SPHERICAL $\nabla V=\frac{\partial V}{\partial r}\mathbf{a}_{r}+\frac{1}{r}\frac{\partial V}{\partial\theta}\mathbf{a}_{\theta}+\frac{1}{r\sin\theta}\frac{\partial V}{\partial\phi}\mathbf{a}_{\phi}$

#### CURL

RECTANGULAR $ \nabla\times\mathbf{H}=\left(\frac{\partial H_{

[Truncated for analysis]

#### Page 606

#### LAPLACIAN

RECTANGULAR $\nabla^{2}V=\frac{\partial^{2}V}{\partial x^{2}}+\frac{\partial^{2}V}{\partial y^{2}}+\frac{\partial^{2}V}{\partial z^{2}}$

CYLINDRICAL $\nabla^{2}V=\frac{1}{\rho}\frac{\partial}{\partial\rho}(\rho\frac{\partial V}{\partial\rho})+\frac{1}{\rho^{2}}\frac{\partial^{2}V}{\partial\phi^{2}}+\frac{\partial^{2}V}{\partial z^{2}}$

SPHERICAL $\nabla^{2}V=\frac{1}{r^{2}}\frac{\partial}{\partial r}(r^{2}\frac{\partial V}{\partial r})+\frac{1}{r^{2}\sin\theta}\frac{\partial}{\partial\theta}(\sin\theta\frac{\partial V}{\partial\theta})+\frac{1}{r^{2}\sin^{2}\theta}\frac{\partial^{2}V}{\partial\phi^{2}}$

#### VECTOR LAPLACIAN

RECTANGULAR $\nabla^{2}A=(\nabla^{2}A_{x})\mathbf{a}_{x}+(\nabla^{2}A_{y})\mathbf{a}_{y}+(\nabla^{2}A_{z})\mathbf{a}_{z}$

CYLINDRICAL $\nabla^{2}A=(\nabla^{2}A_{\rho}-\frac{2}{\rho^{2}}\frac{\partial A_{\phi}}{\partial\phi}-\frac{1}{\rho^{2}}A_{\rho})\mathbf{a}_{\rho}+(\nabla^{2}A_{\phi}+\frac{2}{\rho^{2}}\frac{\partial A_{\rho}}{\partial\phi}-\frac{1}{\rho^{2}}A_{\phi})\mathbf{a}_{\phi}+(\nabla^{2}A_{z})\,\mathbf{a}_{z}$

SPHERICAL $ \nabla^{2}A=\left[\nabla^{2}A_{r}-\frac{2}{r^{2}}\left(A_{r}+A_{\theta}\cot\theta+\frac{\partial

[Truncated for analysis]

## Core Ideas

- Divergence maps a vector field to a scalar that represents local source or sink behavior.
- Gradient maps a scalar field to a vector containing its directional rates of change.
- Curl maps a vector field to a vector representing local circulation.
- The scalar Laplacian is the sum of second derivatives in rectangular coordinates.
- Cylindrical and spherical operators contain scale factors involving $\rho$, $r$, and $\sin\theta$.
- The rectangular vector Laplacian is obtained by applying the scalar Laplacian to each component.
- Curvilinear vector Laplacians contain extra terms that couple field components.

## Source Anchors

- Page 605 gives rectangular divergence as $\nabla\cdot\mathbf{D}=\frac{\partial D_x}{\partial x}+\frac{\partial D_y}{\partial y}+\frac{\partial D_z}{\partial z}$.
- Page 605 gives cylindrical divergence as $\nabla\cdot\mathbf{D}=\frac{1}{\rho}\frac{\partial}{\partial\rho}(\rho D_\rho)+\frac{1}{\rho}\frac{\partial D_\phi}{\partial\phi}+\frac{\partial D_z}{\partial z}$.
- Page 605 gives spherical gradient as $\nabla V=\frac{\partial V}{\partial r}\mathbf{a}_r+\frac{1}{r}\frac{\partial V}{\partial\theta}\mathbf{a}_\theta+\frac{1}{r\sin\theta}\frac{\partial V}{\partial\phi}\mathbf{a}_\phi$.
- Page 605 lists complete rectangular, cylindrical, and spherical formulas for $\nabla\times\mathbf{H}$.
- Page 606 gives rectangular scalar Laplacian as $\nabla^2V=\frac{\partial^2V}{\partial x^2}+\frac{\partial^2V}{\partial y^2}+\frac{\partial^2V}{\partial z^2}$.
- Page 606 shows additional geometric and component-coupling terms in cylindrical and spherical vector Laplacians.

## Related Pages

- [[vector-analysis-and-electromagnetic-coordinate-systems|Vector Analysis and Electromagnetic Coordinate Systems]]
- [[electrostatic-fields-and-gausss-law|Electrostatic Fields and Gauss's Law]]
- [[electric-potential-energy-and-capacitance|Electric Potential, Energy, and Capacitance]]
- [[time-varying-fields-and-maxwells-equations|Time-Varying Fields and Maxwell's Equations]]
- [[uniform-plane-waves-and-material-propagation|Uniform Plane Waves and Material Propagation]]

## Concept Dependencies

- depends-on: [[vector-analysis-and-electromagnetic-coordinate-systems|Vector Analysis and Electromagnetic Coordinate Systems]]
