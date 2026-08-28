---
title: "Point Form of Ampere's Law"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "point-form-of-amperes-law"
locations: ["Page 215", "Page 216", "Equations 7.27-7.29", "Section 7.4: Stokes' Theorem"]
related: ["ampere-circuital-law-enclosed-current", "curl-circulation-per-unit-area", "coordinate-formulas-for-curl", "stokes-theorem-integral-point-bridge"]
---

## ConceptNode: Point Form of Ampere's Law

Planning node for [[point-form-of-amperes-law|1.116 Point Form of Ampere's Law]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 215, Page 216, Equations 7.27-7.29, Section 7.4: Stokes' Theorem

Combining the three Cartesian curl components obtained from differential Amperian loops produces the magnetostatic point equation

$$\nabla\times\mathbf{H}=\mathbf{J}.$$

This equation states that the curl of magnetic field intensity at a point equals the volume current density at that point. It is the differential, or per-unit-area, form of Ampere's circuital law and is identified as the second of Maxwell's four equations under non-time-varying conditions. The text also records the electrostatic counterpart

$$\nabla\times\mathbf{E}=0,$$

which follows from $\oint\mathbf{E}\cdot d\mathbf{L}=0$. The contrast is physically important: electrostatic electric fields have zero circulation around every closed path, while magnetostatic magnetic fields can have nonzero circulation when current pierces the path. The current density can therefore be recovered from a known magnetic field by evaluating its curl in the appropriate coordinate system.

### Key planning details

- The point form of Ampere's law is $\nabla\times\mathbf{H}=\mathbf{J}$.
- It relates a local field derivative to local current density.
- It is the differential counterpart of $\oint\mathbf{H}\cdot d\mathbf{L}=I_{\mathrm{encl}}$.
- The equation is a magnetostatic Maxwell equation.
- Electrostatics instead gives $\nabla\times\mathbf{E}=0$.
- A known magnetic field can be differentiated to determine $\mathbf{J}$.

### Source coverage

- Page 215 combines the three Cartesian curl components into $\nabla\times\mathbf{H}=\mathbf{J}$.
- Page 215 labels this relationship as the point form of Ampere's circuital law.
- Page 215 identifies it as the second Maxwell equation for non-time-varying conditions.
- Page 215 gives $\nabla\times\mathbf{E}=0$ as the point form of zero electrostatic circulation.
- Page 216 states that the point form applies on a per-unit-area basis.
