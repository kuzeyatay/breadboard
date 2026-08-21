---
title: "Vector Component Transformation by Projection"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "vector-component-transformation-by-projection"
locations: ["Page 29", "Section: 1.8.5 Vector Component Transformations", "Page 30", "Table 1.1", "Problems D1.6", "Page 33", "Section: 1.9.5 Vector Component Transformations", "Table 1.2"]
related: ["right-handed-curvilinear-unit-vector-bases", "rectangular-and-cylindrical-point-transformations", "rectangular-and-spherical-point-transformations", "worked-curvilinear-vector-field-transformations", "spherical-and-rectangular-basis-transformation-table"]
---

## ConceptNode: Vector Component Transformation by Projection

Planning node for [[vector-component-transformation-by-projection|1.23 Vector Component Transformation by Projection]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 29, Section: 1.8.5 Vector Component Transformations, Page 30, Table 1.1, Problems D1.6, Page 33, Section: 1.9.5 Vector Component Transformations, Table 1.2

Transforming a vector field requires more than changing its coordinate variables because the basis vectors also change. The source separates the task into two independent operations: substitute the point-coordinate relations, and project the vector onto the destination basis. A component in any unit-vector direction is obtained by a dot product. For cylindrical coordinates, $A_\rho=\mathbf{A}\cdot\mathbf{a}_\rho$, $A_\phi=\mathbf{A}\cdot\mathbf{a}_\phi$, and $A_z$ remains the rectangular $z$ component. Table 1.1 supplies the required basis dot products, including $\mathbf{a}_x\cdot\mathbf{a}_\rho=\cos\phi$, $\mathbf{a}_y\cdot\mathbf{a}_\rho=\sin\phi$, $\mathbf{a}_x\cdot\mathbf{a}_\phi=-\sin\phi$, and $\mathbf{a}_y\cdot\mathbf{a}_\phi=\cos\phi$. Variable substitution and component projection may be performed in either order. This projection method extends directly to spherical transformations through Table 1.2.

### Key planning details

- Change both the variables and the vector basis.
- Find a destination component by dotting the vector with the corresponding destination unit vector.
- $A_\rho=A_x\cos\phi+A_y\sin\phi$.
- $A_\phi=-A_x\sin\phi+A_y\cos\phi$.
- $A_z$ is unchanged between rectangular and cylindrical bases.
- The inverse transformation uses the same table with projections onto rectangular unit vectors.
- Variable substitution and basis conversion can be performed in either order.

### Source coverage

- Equations (12) through (14) introduce projection onto $\mathbf{a}_\rho$, $\mathbf{a}_\phi$, and $\mathbf{a}_z$.
- Table 1.1 gives all dot products between rectangular and cylindrical unit vectors.
- The angle between $\mathbf{a}_x$ and $\mathbf{a}_\rho$ is identified as $\phi$.
- The angle between $\mathbf{a}_y$ and $\mathbf{a}_\rho$ is identified as $90^\circ-\phi$.
- The source states that variable conversion and component conversion may be done in either order.
- D1.6 practices rectangular-to-cylindrical and cylindrical-to-rectangular component transformations.
