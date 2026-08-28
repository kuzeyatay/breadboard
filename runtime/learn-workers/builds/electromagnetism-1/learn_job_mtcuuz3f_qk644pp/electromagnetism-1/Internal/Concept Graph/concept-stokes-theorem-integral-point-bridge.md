---
title: "Stokes' Theorem as the Integral-to-Point Bridge"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "stokes-theorem-integral-point-bridge"
locations: ["Page 216", "Section 7.4: Stokes' Theorem"]
related: ["curl-circulation-per-unit-area", "point-form-of-amperes-law", "ampere-circuital-law-enclosed-current"]
---

## ConceptNode: Stokes' Theorem as the Integral-to-Point Bridge

Planning node for [[stokes-theorem-integral-point-bridge|1.117 Stokes' Theorem as the Integral-to-Point Bridge]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 216, Section 7.4: Stokes' Theorem

Stokes' theorem provides the mathematical bridge between the point form and integral form of Ampere's law. The source begins with a surface $S$ divided into small areas $\Delta S$. For each small element, the curl definition gives approximately

$$\frac{\oint\mathbf{H}\cdot d\mathbf{L}_{\Delta S}}{\Delta S}\approx(\nabla\times\mathbf{H})\cdot\mathbf{a}_N,$$

or

$$\oint\mathbf{H}\cdot d\mathbf{L}_{\Delta S}\approx(\nabla\times\mathbf{H})\cdot\Delta\mathbf{S}.$$

The normal $\mathbf{a}_N$ is the right-hand normal associated with the orientation of the incremental boundary. The next step, begun at the end of this chunk, is to sum these circulations over every small surface element. Contributions along shared internal edges cancel because neighboring elements traverse each common edge in opposite directions. In the limiting sum, only the circulation around the outer boundary remains, connecting a boundary line integral with a surface integral of curl. This allows $\nabla\times\mathbf{H}=\mathbf{J}$ and $\oint\mathbf{H}\cdot d\mathbf{L}=I_{\mathrm{encl}}$ to be obtained from one another.

### Key planning details

- Stokes' theorem links a boundary circulation to a surface integral of curl.
- The surface is partitioned into incremental areas.
- Each incremental circulation approximates curl dotted with the area vector.
- Boundary orientation and area normal obey the right-hand rule.
- Shared internal-edge contributions cancel in the surface sum.
- The theorem converts between point and integral forms of Ampere's law.
- The derivation begins in this chunk and continues beyond Page 216.

### Source coverage

- Page 216 states that Stokes' theorem can recover Ampere's circuital law from $\nabla\times\mathbf{H}=\mathbf{J}$.
- Page 216 introduces a surface $S$ divided into incremental surfaces of area $\Delta S$.
- Page 216 writes $\oint\mathbf{H}\cdot d\mathbf{L}_{\Delta S}/\Delta S\approx(\nabla\times\mathbf{H})_N$.
- Page 216 rewrites the normal component as $(\nabla\times\mathbf{H})\cdot\mathbf{a}_N$.
- Page 216 obtains $\oint\mathbf{H}\cdot d\mathbf{L}_{\Delta S}\approx(\nabla\times\mathbf{H})\cdot\Delta\mathbf{S}$.
- The final paragraph on Page 216 begins summing the circulation over all incremental areas and introduces cancellation.
