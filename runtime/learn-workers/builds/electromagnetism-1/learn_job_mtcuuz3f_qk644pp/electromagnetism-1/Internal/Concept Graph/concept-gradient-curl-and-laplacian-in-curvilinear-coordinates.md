---
title: "Gradient, Curl, and Laplacian in Curvilinear Coordinates"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "gradient-curl-and-laplacian-in-curvilinear-coordinates"
locations: ["Page 571, Section A.2", "Page 572, Section A.2"]
related: ["orthogonal-curvilinear-coordinates-and-scale-factors", "divergence-in-orthogonal-curvilinear-coordinates", "vector-identities-for-electromagnetic-analysis", "uniqueness-theorem-for-laplace-and-poisson-equations"]
---

## ConceptNode: Gradient, Curl, and Laplacian in Curvilinear Coordinates

Planning node for [[gradient-curl-and-laplacian-in-curvilinear-coordinates|1.345 Gradient, Curl, and Laplacian in Curvilinear Coordinates]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 571, Section A.2, Page 572, Section A.2

The gradient follows by matching the scalar differential $dV$ to $\nabla V\cdot d\mathbf{L}$, where $d\mathbf{L}=h_1du\mathbf{a}_u+h_2dv\mathbf{a}_v+h_3dw\mathbf{a}_w$. This gives $$\nabla V=\frac{1}{h_1}\frac{\partial V}{\partial u}\mathbf{a}_u+\frac{1}{h_2}\frac{\partial V}{\partial v}\mathbf{a}_v+\frac{1}{h_3}\frac{\partial V}{\partial w}\mathbf{a}_w.$$ Curl is derived from circulation around a differential coordinate-surface loop. Its $u$ component is $$ (\nabla\times\mathbf{H})_u=\frac{1}{h_2h_3}\left[\frac{\partial}{\partial v}(h_3H_w)-\frac{\partial}{\partial w}(h_2H_v)\right],$$ with the other components obtained cyclically and the complete operator represented by determinant (A.4). Applying divergence to the gradient gives the scalar Laplacian $$\nabla^2V=\frac{1}{h_1h_2h_3}\left[\frac{\partial}{\partial u}\left(\frac{h_2h_3}{h_1}\frac{\partial V}{\partial u}\right)+\frac{\partial}{\partial v}\left(\frac{h_3h_1}{h_2}\frac{\partial V}{\partial v}\right)+\frac{\partial}{\partial w}\left(\frac{h_1h_2}{h_3}\frac{\partial V}{\partial w}\right)\right].$$

### Key planning details

- Gradient components are directional rates per unit physical length.
- Each gradient component contains the reciprocal scale factor $1/h_i$.
- Curl is circulation per enclosed physical area.
- The $u$ curl component uses derivatives with respect to $v$ and $w$.
- The other curl components follow by cyclic permutation.
- The scalar Laplacian is $\nabla\cdot\nabla V$.
- Equations (A.2) through (A.5) apply to any orthogonal system with known scale factors.

### Source coverage

- Equation (A.3) gives the general gradient formula.
- Page 571 derives the $\mathbf{a}_u$ component of curl from a loop in a $u=\mathrm{constant}$ surface.
- Equation (A.4) gives curl as a determinant involving scale factors.
- Equation (A.5) gives the scalar Laplacian.
- Page 572 states that Eqs. (A.2) to (A.5) apply to any orthogonal coordinate system with known $h_1,h_2,h_3$.
