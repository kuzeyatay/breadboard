---
title: "Coordinate Formulas for Curl"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "coordinate-formulas-for-curl"
locations: ["Page 211", "Page 212", "Page 216", "Equations 7.22-7.26", "Exercises D7.4-D7.5"]
related: ["curl-circulation-per-unit-area", "physical-meaning-of-curl", "point-form-of-amperes-law"]
---

## ConceptNode: Coordinate Formulas for Curl

Planning node for [[coordinate-formulas-for-curl|1.113 Coordinate Formulas for Curl]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 211, Page 212, Page 216, Equations 7.22-7.26, Exercises D7.4-D7.5

The geometric definition of curl leads to coordinate-specific differentiation formulas. In rectangular coordinates,

$$\nabla\times\mathbf{H}=\left(\frac{\partial H_z}{\partial y}-\frac{\partial H_y}{\partial z}\right)\mathbf{a}_x+\left(\frac{\partial H_x}{\partial z}-\frac{\partial H_z}{\partial x}\right)\mathbf{a}_y+\left(\frac{\partial H_y}{\partial x}-\frac{\partial H_x}{\partial y}\right)\mathbf{a}_z.$$

The same expression can be stored mnemonically as a determinant involving the unit vectors, derivative operators, and field components. The compact notation is $\operatorname{curl}\mathbf{H}=\nabla\times\mathbf{H}$. Cylindrical and spherical forms contain scale factors arising from their curvilinear coordinates. For example, the cylindrical axial component is

$$(\nabla\times\mathbf{H})_z=\frac{1}{\rho}\frac{\partial(\rho H_\phi)}{\partial\rho}-\frac{1}{\rho}\frac{\partial H_\rho}{\partial\phi}.$$

The formulas must be matched to the coordinate system used to express the field. Exercises D7.4 and D7.5 connect finite circulation approximations with direct curl evaluation in rectangular, cylindrical, and spherical coordinates.

### Key planning details

- Curl has three components formed from differences of cross-partial derivatives.
- The determinant is a mnemonic for the rectangular-coordinate expansion.
- The concise operator notation is $\nabla\times\mathbf{H}$.
- Cylindrical-coordinate curl contains factors of $\rho$.
- Spherical-coordinate curl contains factors of $r$ and $\sin\theta$.
- The chosen formula must match the coordinate basis of the field.
- Curl evaluation provides current density through the point form of Ampere's law.

### Source coverage

- Page 211 gives the full rectangular-coordinate curl expansion.
- Page 212 gives the determinant representation of curl.
- Page 212 writes $\operatorname{curl}\mathbf{H}=\nabla\times\mathbf{H}$.
- Page 212 provides the cylindrical-coordinate formula for $\nabla\times\mathbf{H}$.
- Page 212 provides the spherical-coordinate formula for $\nabla\times\mathbf{H}$.
- Page 216 exercise D7.4 compares finite circulation per area with the curl at the rectangle center.
- Page 216 exercise D7.5 asks for current density from curl in three coordinate systems.
