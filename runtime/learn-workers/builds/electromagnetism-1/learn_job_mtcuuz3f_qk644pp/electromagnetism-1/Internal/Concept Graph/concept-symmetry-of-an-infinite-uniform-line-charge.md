---
title: "Symmetry of an Infinite Uniform Line Charge"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "symmetry-of-an-infinite-uniform-line-charge"
locations: ["Page 48", "Page 49", "Section: 2.4 Field of a Line Charge", "Section: 2.4.1 Setting Up the Problem: The Importance of Symmetry"]
related: ["derivation-and-distance-scaling-of-the-infinite-line-field", "off-axis-infinite-line-charge", "field-of-an-infinite-uniform-sheet"]
---

## ConceptNode: Symmetry of an Infinite Uniform Line Charge

Planning node for [[symmetry-of-an-infinite-uniform-line-charge|1.42 Symmetry of an Infinite Uniform Line Charge]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 48, Page 49, Section: 2.4 Field of a Line Charge, Section: 2.4.1 Setting Up the Problem: The Importance of Symmetry

Before integrating the field of an infinite uniform line charge, symmetry determines its possible coordinate dependence and components. A line extending along the entire $z$ axis looks unchanged under rotation about that axis, so azimuthal symmetry eliminates dependence on $\phi$. Translating the observation point along $z$ also leaves the source unchanged, so axial symmetry eliminates dependence on $z$. Changing radial distance $\rho$ does change the geometry, so the field can depend on $\rho$. Each source element produces radial and axial differential components, but elements located equal distances above and below the observation plane produce equal and opposite axial contributions. No azimuthal contribution is produced. Consequently, the total field has only a radial component and can be written as $\mathbf{E}=E_\rho(\rho)\mathbf{a}_\rho$. This symmetry analysis predicts the final field structure before any calculus is performed.

### Key planning details

- Rotational invariance removes all $\phi$ dependence.
- Translation invariance along the line removes all $z$ dependence.
- The field may vary with radial distance $\rho$.
- No source element produces a net azimuthal component.
- Axial components cancel in symmetric pairs above and below the observation plane.
- The only surviving component is $E_\rho(\rho)$.

### Source coverage

- The source is a uniform line charge extending from $-\infty$ to $\infty$ along the $z$ axis.
- The text identifies azimuthal symmetry and axial symmetry separately.
- Pairs of source elements at opposite values of $z'$ cancel their $E_z$ contributions.
- Source figure S1.P48.F1, Figure 2.6, shows $d\mathbf{E}=dE_\rho\mathbf{a}_\rho+dE_z\mathbf{a}_z$ from $dQ=\rho_Ldz'$.
- The general observation point may be chosen in the $xy$ plane because the field is independent of $\phi$ and $z$.
