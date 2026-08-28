---
title: "Magnetic Field of an Infinite Current Sheet"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "magnetic-field-infinite-current-sheet"
locations: ["Page 206", "Page 207", "Section 7.2.4: Magnetic Field of a Surface Current", "Figure S1.P206.F2"]
related: ["current-source-representations", "ampere-circuital-law-enclosed-current", "magnetic-fields-solenoids-toroids"]
---

## ConceptNode: Magnetic Field of an Infinite Current Sheet

Planning node for [[magnetic-field-infinite-current-sheet|1.110 Magnetic Field of an Infinite Current Sheet]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 206, Page 207, Section 7.2.4: Magnetic Field of a Surface Current, Figure S1.P206.F2

For a uniform current sheet in the $z=0$ plane with $\mathbf{K}=K_y\mathbf{a}_y$, translational symmetry prevents variation with $x$ or $y$. A filament decomposition shows that no $H_y$ component is produced, while the $H_z$ contributions from symmetrically placed filaments cancel. Only $H_x$ remains. A rectangular Amperian loop crossing the sheet gives $H_{x1}-H_{x2}=K_y$. Additional loops show that the field is uniform throughout each half-space, and reflection symmetry makes the fields on opposite sides equal in magnitude and opposite in direction. Thus

$$H_x=\frac{K_y}{2}\quad(z>0),\qquad H_x=-\frac{K_y}{2}\quad(z<0).$$

Using an outward normal $\mathbf{a}_N$, the result is

$$\mathbf{H}=\frac{1}{2}\mathbf{K}\times\mathbf{a}_N.$$

For two parallel sheets carrying opposite currents, the fields add between the sheets and cancel outside, producing $\mathbf{H}=\mathbf{K}\times\mathbf{a}_N$ internally and zero externally.

### Key planning details

- A uniform infinite current sheet produces a spatially uniform field on each side.
- Symmetric filament pairs cancel the normal field component.
- The field is perpendicular to both the sheet current and the sheet normal.
- Each side has field magnitude $K/2$.
- The compact direction formula is $\mathbf{H}=\tfrac{1}{2}\mathbf{K}\times\mathbf{a}_N$.
- Oppositely directed parallel sheets double the field between them.
- The same two sheets cancel the field outside.

### Source coverage

- Figure S1.P206.F2 shows the current sheet and rectangular Amperian paths.
- Page 206 states that symmetric filament contributions cancel $H_z$ and leave only $H_x$.
- Pages 206-207 derive $H_{x1}-H_{x2}=K_y$.
- Page 207 gives $H_x=K_y/2$ above and $H_x=-K_y/2$ below the sheet.
- Page 207 gives $\mathbf{H}=\mathbf{K}\times\mathbf{a}_N/2$.
- Page 207 gives $\mathbf{H}=\mathbf{K}\times\mathbf{a}_N$ between two opposite-current sheets and zero outside.
- Page 207 emphasizes that identifying the field components is the hardest part of applying Ampere's law.
