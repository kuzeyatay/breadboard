---
title: "Field of an Infinite Uniform Sheet"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "field-of-an-infinite-uniform-sheet"
locations: ["Page 51", "Page 52", "Page 53", "Section: 2.5 Field of a Sheet of Charge", "Section: 2.5.1 Symmetry", "Section: 2.5.2 The Sheet Charge as an Ensemble of Line Charges"]
related: ["symmetry-of-an-infinite-uniform-line-charge", "derivation-and-distance-scaling-of-the-infinite-line-field", "parallel-plate-capacitor-field", "charge-distribution-dimensionality"]
---

## ConceptNode: Field of an Infinite Uniform Sheet

Planning node for [[field-of-an-infinite-uniform-sheet|1.45 Field of an Infinite Uniform Sheet]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 51, Page 52, Page 53, Section: 2.5 Field of a Sheet of Charge, Section: 2.5.1 Symmetry, Section: 2.5.2 The Sheet Charge as an Ensemble of Line Charges

An infinite uniform sheet in the $yz$ plane is unchanged by translations along $y$ or $z$, so its field cannot depend on either coordinate. Symmetrically located source elements cancel all tangential components, leaving only a component normal to the sheet. The sheet can be divided into differential strips parallel to the $z$ axis. Each strip behaves as an infinite line charge with $d\rho_L=\rho_Sdy'$. The normal component of each strip field is integrated over $-\infty<y'<\infty$. The resulting field has constant magnitude $\rho_S/(2\epsilon_0)$ and points away from a positively charged sheet on either side. A normal unit vector directed outward avoids separate sign formulas. Unlike point and line fields, the ideal infinite-sheet field does not decrease with distance because progressively more distant portions of the infinite sheet continue contributing.

### Key planning details

- Translational symmetry removes dependence on coordinates parallel to the sheet.
- Tangential field components cancel by symmetry.
- Only the normal component remains.
- A differential strip has line density $d\rho_L=\rho_Sdy'$.
- The ideal infinite-sheet field is independent of distance.
- Its direction is away from positive surface charge.

### Source coverage

- Source figure S1.P51.F1, Figure 2.8, shows an infinite sheet in the $yz$ plane and a point $P$ on the $x$ axis.
- For a strip, $$dE_x=\frac{\rho_S}{2\pi\epsilon_0}\frac{x\,dy'}{x^2+y'^2}.$$
- The strips are integrated over $-\infty<y'<\infty$.
- Equation (17): $$\mathbf{E}=\frac{\rho_S}{2\epsilon_0}\mathbf{a}_N.$$
- On opposite sides of the sheet, the field has equal magnitude and opposite normal direction.
- The text compares the constant field with illumination from a uniformly luminous infinite ceiling.
