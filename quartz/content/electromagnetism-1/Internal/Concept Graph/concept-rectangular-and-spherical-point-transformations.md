---
title: "Rectangular and Spherical Point Transformations"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "rectangular-and-spherical-point-transformations"
locations: ["Page 32", "Section: 1.9.4 Point Transformations", "Page 33", "Equation (16)", "Page 34", "Problems D1.7 and D1.8"]
related: ["spherical-coordinates-and-coordinate-surfaces", "vector-component-transformation-by-projection", "worked-curvilinear-vector-field-transformations"]
---

## ConceptNode: Rectangular and Spherical Point Transformations

Planning node for [[rectangular-and-spherical-point-transformations|1.27 Rectangular and Spherical Point Transformations]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 32, Section: 1.9.4 Point Transformations, Page 33, Equation (16), Page 34, Problems D1.7 and D1.8

Spherical-to-rectangular conversion resolves the radial distance into its projection on the $xy$ plane and then into $x$ and $y$ components. The resulting equations are $x=r\sin\theta\cos\phi$, $y=r\sin\theta\sin\phi$, and $z=r\cos\theta$. The reverse transformation uses the Euclidean distance $r=\sqrt{x^2+y^2+z^2}$, the polar-angle relation $\theta=\cos^{-1}(z/r)$, and the azimuth relation $\phi=\tan^{-1}(y/x)$ with quadrant inspection. The source restricts $r\geq0$ and $0^\circ\leq\theta\leq180^\circ$. These range conventions prevent multiple spherical descriptions from being treated as distinct points. As in cylindrical coordinates, the signs of the rectangular coordinates must be inspected to place angles in the proper quadrants. Problems D1.7 and D1.8 combine point conversion, distance calculation, and vector transformation.

### Key planning details

- Use $x=r\sin\theta\cos\phi$.
- Use $y=r\sin\theta\sin\phi$.
- Use $z=r\cos\theta$.
- Use $r=\sqrt{x^2+y^2+z^2}$ with $r\geq0$.
- Use $\theta=\cos^{-1}(z/r)$ with $0^\circ\leq\theta\leq180^\circ$.
- Determine $\phi$ from $y/x$ and the signs of $x$ and $y$.
- Coordinate conversion can be combined with Euclidean distance calculations.

### Source coverage

- Equation (15) gives the three spherical-to-rectangular relations.
- Equation (16) gives $r$, $\theta$, and $\phi$ in terms of $x$, $y$, and $z$.
- The source explicitly states the ranges of $r$ and $\theta$.
- D1.7 converts point C from rectangular to spherical coordinates and point D from spherical to rectangular coordinates.
- D1.7 reports the distance from C to D as $6.29$.
- D1.8 transforms fixed rectangular unit-direction vectors into spherical components at specified points.
