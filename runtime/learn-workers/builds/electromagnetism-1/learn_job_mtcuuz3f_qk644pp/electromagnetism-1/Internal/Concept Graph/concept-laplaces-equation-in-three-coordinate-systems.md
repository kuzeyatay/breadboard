---
title: "Laplace's Equation in Three Coordinate Systems"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "laplaces-equation-in-three-coordinate-systems"
locations: ["Page 175", "Page 176"]
related: ["derivation-of-poissons-equation", "boundary-conditions-and-the-uniqueness-theorem", "direct-integration-of-one-dimensional-laplace-problems"]
---

## ConceptNode: Laplace's Equation in Three Coordinate Systems

Planning node for [[laplaces-equation-in-three-coordinate-systems|1.90 Laplace's Equation in Three Coordinate Systems]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 175, Page 176

Laplace's equation is the charge-free specialization of Poisson's equation. When $\rho_v=0$ throughout a region, $$\nabla^2V=0.$$ Point, line, and surface charges may still occur at singular locations or boundaries, but there is no distributed volume charge in the region where the equation is applied. In rectangular coordinates, the equation is $$\frac{\partial^2V}{\partial x^2}+\frac{\partial^2V}{\partial y^2}+\frac{\partial^2V}{\partial z^2}=0.$$ In cylindrical coordinates, it is $$\frac{1}{\rho}\frac{\partial}{\partial\rho}\left(\rho\frac{\partial V}{\partial\rho}\right)+\frac{1}{\rho^2}\frac{\partial^2V}{\partial\phi^2}+\frac{\partial^2V}{\partial z^2}=0.$$ In spherical coordinates, it is $$\frac{1}{r^2}\frac{\partial}{\partial r}\left(r^2\frac{\partial V}{\partial r}\right)+\frac{1}{r^2\sin\theta}\frac{\partial}{\partial\theta}\left(\sin\theta\frac{\partial V}{\partial\theta}\right)+\frac{1}{r^2\sin^2\theta}\frac{\partial^2V}{\partial\phi^2}=0.$$ The unexpanded cylindrical and spherical forms preserve the geometric factors needed for correct differentiation.

### Key planning details

- Laplace's equation applies where $\rho_v=0$.
- Boundary or singular point, line, and surface charges may still source the field.
- The Laplacian has coordinate-dependent geometric factors.
- Rectangular coordinates use a direct sum of three second derivatives.
- Cylindrical coordinates contain $1/\rho$ and $1/\rho^2$ factors.
- Spherical coordinates contain $r^2$ and $\sin\theta$ factors.
- The source recommends retaining the compact divergence-gradient forms.

### Source coverage

- Equation (27) states $\nabla^2V=0$.
- Equation (28) gives the rectangular-coordinate form.
- Equation (29) gives the cylindrical-coordinate Laplacian.
- Equation (30) gives the spherical-coordinate Laplacian.
- The text explicitly allows singular point, line, and surface charge sources when the regional volume charge density is zero.
- The compact coordinate forms are described as easier to expand than to reconstruct.
