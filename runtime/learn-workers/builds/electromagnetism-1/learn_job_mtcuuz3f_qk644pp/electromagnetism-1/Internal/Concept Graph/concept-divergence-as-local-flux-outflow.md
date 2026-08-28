---
title: "Divergence as Local Flux Outflow"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "divergence-as-local-flux-outflow"
locations: ["Page 76", "Page 77", "Page 78", "Example 3.4"]
related: ["differential-volume-derivation-of-divergence", "divergence-in-coordinate-systems", "maxwells-first-equation", "del-operator-and-divergence-notation"]
---

## ConceptNode: Divergence as Local Flux Outflow

Planning node for [[divergence-as-local-flux-outflow|1.63 Divergence as Local Flux Outflow]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 76, Page 77, Page 78, Example 3.4

Divergence is defined for a vector field $\mathbf{A}$ as the net outward flux through a shrinking closed surface divided by the enclosed volume: $\operatorname{div}\mathbf{A}=\lim_{\Delta v\to0}[\oint_S\mathbf{A}\cdot d\mathbf{S}]/\Delta v$. It is a scalar measure of how strongly the field behaves as a source or sink at a point. Positive divergence indicates net local outflow, negative divergence indicates net local inflow, and zero divergence indicates no net source or sink within the differential volume. The text illustrates zero divergence using incompressible water away from the moving free surface and positive divergence using expanding air in a punctured tire. Divergence has no direction, despite being calculated from a vector field. For electric flux density measured in $\mathrm{C/m^2}$, divergence has units $\mathrm{C/m^3}$, matching volume charge density. Example 3.4 calculates the divergence of $\mathbf{D}=e^{-x}\sin y\,\mathbf{a}_x-e^{-x}\cos y\,\mathbf{a}_y+2z\,\mathbf{a}_z$ and finds the constant value $2$ because the first two derivative terms cancel.

### Key planning details

- Divergence is outward flux per unit volume in the zero-volume limit.
- Divergence acts on a vector field and produces a scalar.
- Positive divergence indicates a local source.
- Negative divergence indicates a local sink.
- Zero divergence indicates no net local source or sink.
- Divergence has no associated direction or unit vector.
- For $\mathbf{D}$ in $\mathrm{C/m^2}$, divergence has units $\mathrm{C/m^3}$.

### Source coverage

- Page 76 defines $\operatorname{div}\mathbf{A}=\lim_{\Delta v\to0}\oint_S\mathbf{A}\cdot d\mathbf{S}/\Delta v$.
- Pages 76 and 77 interpret divergence as flux outflow per unit volume.
- Page 77 uses incompressible bathtub water as a zero-divergence example.
- Page 77 uses expanding air in a punctured tire as a positive-divergence example.
- Page 78 warns that divergence is a scalar and carries no direction.
- Example 3.4 on Page 78 obtains $\operatorname{div}\mathbf{D}=2$ everywhere.
