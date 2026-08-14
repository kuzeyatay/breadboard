---
title: "Rectangular and Cylindrical Point Transformations"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "rectangular-and-cylindrical-point-transformations"
locations: ["Page 28", "Section: 1.8.4 Point Transformations", "Figure 1.7", "Page 29", "Page 30", "Problem D1.5"]
related: ["cylindrical-coordinates-and-coordinate-surfaces", "vector-component-transformation-by-projection", "rectangular-and-spherical-point-transformations"]
---

## ConceptNode: Rectangular and Cylindrical Point Transformations

Planning node for [[rectangular-and-cylindrical-point-transformations|1.22 Rectangular and Cylindrical Point Transformations]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 28, Section: 1.8.4 Point Transformations, Figure 1.7, Page 29, Page 30, Problem D1.5

Rectangular and cylindrical point coordinates describe the same physical point using different variables. Projection of the radial distance $\rho$ onto the rectangular axes gives $x=\rho\cos\phi$ and $y=\rho\sin\phi$, while the axial coordinate remains unchanged. Conversely, $\rho=\sqrt{x^2+y^2}$ and $\phi$ is determined from the ratio $y/x$ together with the signs of $x$ and $y$. The sign inspection is essential because a basic inverse tangent does not uniquely identify the quadrant. The source illustrates this with $(-3,4)$, which gives $\rho=5$ and $\phi=126.9^\circ$, and $(3,-4)$, which permits $\phi=-53.1^\circ$ or $306.9^\circ$. Scalar functions can be transformed by substituting these variable relations directly. Figure 1.7 provides the geometric source for both the coordinate equations and the later basis-vector projections.

### Key planning details

- Use $x=\rho\cos\phi$.
- Use $y=\rho\sin\phi$.
- The relation $z=z$ means the axial variable is unchanged.
- Use $\rho=\sqrt{x^2+y^2}$ with $\rho\geq 0$.
- Use $\phi=\tan^{-1}(y/x)$ only with a quadrant check.
- Equivalent positive and negative angle representations may be chosen for convenience.
- Transform scalar functions by substituting the point-coordinate relations.

### Source coverage

- Equations (10) state $x=\rho\cos\phi$, $y=\rho\sin\phi$, and $z=z$.
- Equations (11) state $\rho=\sqrt{x^2+y^2}$ and $\phi=\tan^{-1}(y/x)$.
- Figure 1.7 displays the relationship between the rectangular and cylindrical variables.
- For $x=-3$, $y=4$, the source obtains $\rho=5$ and $\phi=126.9^\circ$.
- For $x=3$, $y=-4$, the source obtains $\phi=-53.1^\circ$ or $306.9^\circ$.
- D1.5 includes point conversion in both directions and a distance calculation.
