---
title: "Curl as Circulation per Unit Area"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "curl-circulation-per-unit-area"
locations: ["Page 209", "Page 210", "Page 211", "Section 7.3: Curl", "Section 7.3.1: Development and Definition of Curl", "Figure S1.P210.F1"]
related: ["ampere-circuital-law-enclosed-current", "coordinate-formulas-for-curl", "physical-meaning-of-curl", "point-form-of-amperes-law"]
---

## ConceptNode: Curl as Circulation per Unit Area

Planning node for [[curl-circulation-per-unit-area|1.112 Curl as Circulation per Unit Area]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 209, Page 210, Page 211, Section 7.3: Curl, Section 7.3.1: Development and Definition of Curl, Figure S1.P210.F1

Curl is derived by applying Ampere's circuital law to a shrinking rectangular path. For a rectangle of sides $\Delta x$ and $\Delta y$ traversed with right-hand normal $\mathbf{a}_z$, first-order expansions of the field components on the four sides give

$$\oint\mathbf{H}\cdot d\mathbf{L}\approx\left(\frac{\partial H_y}{\partial x}-\frac{\partial H_x}{\partial y}\right)\Delta x\Delta y.$$

The enclosed current is approximately $J_z\Delta x\Delta y$. Dividing by area and taking the limit yields

$$\frac{\partial H_y}{\partial x}-\frac{\partial H_x}{\partial y}=J_z.$$

Analogous loops normal to the other coordinate axes produce the other components. In coordinate-independent language,

$$(\operatorname{curl}\mathbf{H})_N=\lim_{\Delta S_N\to0}\frac{\oint\mathbf{H}\cdot d\mathbf{L}}{\Delta S_N}.$$

Curl is therefore a vector whose component normal to a small surface equals circulation per unit area around that surface. The path direction and selected normal are connected by the right-hand rule.

### Key planning details

- Curl is defined locally by circulation around a shrinking path divided by enclosed area.
- The selected curl component is normal to the small planar surface.
- First-order field variations on opposite sides produce differences of partial derivatives.
- For an $xy$ loop, $(\nabla\times\mathbf{H})_z=\partial H_y/\partial x-\partial H_x/\partial y$.
- Ampere's law identifies this component with $J_z$.
- The geometric definition is independent of a particular coordinate system.
- The finite-path circulation becomes an exact local derivative only in the zero-area limit.

### Source coverage

- Figure S1.P210.F1 shows the incremental rectangular path used to determine spatial variation of $\mathbf{H}$.
- Pages 209-210 expand the field components about the center of the rectangle.
- Page 210 obtains $\oint\mathbf{H}\cdot d\mathbf{L}\approx(\partial H_y/\partial x-\partial H_x/\partial y)\Delta x\Delta y$.
- Page 210 identifies the enclosed current as $J_z\Delta x\Delta y$.
- Page 211 gives the analogous $J_x$ and $J_y$ expressions.
- Page 211 defines $(\operatorname{curl}\mathbf{H})_N$ as the limiting circulation per unit area.
