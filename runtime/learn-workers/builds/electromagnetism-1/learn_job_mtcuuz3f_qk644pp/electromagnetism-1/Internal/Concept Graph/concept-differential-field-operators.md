---
title: "Differential Field Operators"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "differential-field-operators"
locations: ["Page 605, Sections: Divergence, Gradient, Curl", "Page 606, Sections: Laplacian, Vector Laplacian"]
related: ["vector-analysis-and-electromagnetic-coordinate-systems", "electrostatic-fields-and-gausss-law", "electric-potential-energy-and-capacitance", "time-varying-fields-and-maxwells-equations", "uniform-plane-waves-and-material-propagation"]
---

## ConceptNode: Differential Field Operators

Planning node for [[differential-field-operators|1.366 Differential Field Operators]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 605, Sections: Divergence, Gradient, Curl, Page 606, Sections: Laplacian, Vector Laplacian

The reference pages collect the differential operators needed to convert between local field behavior and electromagnetic field laws. Divergence acts on a vector field such as electric flux density $\mathbf{D}$ and measures its local outward flux density. Gradient acts on a scalar potential $V$ and produces a vector pointing in the direction of greatest spatial increase. Curl acts on a vector field such as magnetic field intensity $\mathbf{H}$ and measures local circulation. The scalar Laplacian $\nabla^2V$ combines second spatial derivatives and is the operator appearing in Laplace's and Poisson's equations. Page 606 also distinguishes the vector Laplacian from simply writing one coordinate-independent scalar expression. In rectangular coordinates, the vector Laplacian is the componentwise scalar Laplacian. In cylindrical and spherical coordinates, additional component-coupling and geometric terms appear because the coordinate basis changes with position. These formulas form a reusable computational toolkit for applying Gauss's law, potential equations, Ampere's law, Faraday's law, and electromagnetic wave equations in geometries selected to match the physical symmetry.

### Key planning details

- Divergence maps a vector field to a scalar that represents local source or sink behavior.
- Gradient maps a scalar field to a vector containing its directional rates of change.
- Curl maps a vector field to a vector representing local circulation.
- The scalar Laplacian is the sum of second derivatives in rectangular coordinates.
- Cylindrical and spherical operators contain scale factors involving $\rho$, $r$, and $\sin\theta$.
- The rectangular vector Laplacian is obtained by applying the scalar Laplacian to each component.
- Curvilinear vector Laplacians contain extra terms that couple field components.

### Source coverage

- Page 605 gives rectangular divergence as $\nabla\cdot\mathbf{D}=\frac{\partial D_x}{\partial x}+\frac{\partial D_y}{\partial y}+\frac{\partial D_z}{\partial z}$.
- Page 605 gives cylindrical divergence as $\nabla\cdot\mathbf{D}=\frac{1}{\rho}\frac{\partial}{\partial\rho}(\rho D_\rho)+\frac{1}{\rho}\frac{\partial D_\phi}{\partial\phi}+\frac{\partial D_z}{\partial z}$.
- Page 605 gives spherical gradient as $\nabla V=\frac{\partial V}{\partial r}\mathbf{a}_r+\frac{1}{r}\frac{\partial V}{\partial\theta}\mathbf{a}_\theta+\frac{1}{r\sin\theta}\frac{\partial V}{\partial\phi}\mathbf{a}_\phi$.
- Page 605 lists complete rectangular, cylindrical, and spherical formulas for $\nabla\times\mathbf{H}$.
- Page 606 gives rectangular scalar Laplacian as $\nabla^2V=\frac{\partial^2V}{\partial x^2}+\frac{\partial^2V}{\partial y^2}+\frac{\partial^2V}{\partial z^2}$.
- Page 606 shows additional geometric and component-coupling terms in cylindrical and spherical vector Laplacians.
