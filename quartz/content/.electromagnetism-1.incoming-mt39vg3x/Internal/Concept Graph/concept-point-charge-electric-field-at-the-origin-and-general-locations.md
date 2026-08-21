---
title: "Point-Charge Electric Field at the Origin and General Locations"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "point-charge-electric-field-at-the-origin-and-general-locations"
locations: ["Page 42", "Equations (8), (9), and (10)", "Section: 2.2.2 Fields Associated with Charges at General Locations", "Page 43", "Figure 2.2"]
related: ["vector-form-of-coulombs-law", "electric-field-intensity-as-force-per-unit-charge", "electric-field-superposition-from-multiple-point-charges"]
---

## ConceptNode: Point-Charge Electric Field at the Origin and General Locations

Planning node for [[point-charge-electric-field-at-the-origin-and-general-locations|1.35 Point-Charge Electric Field at the Origin and General Locations]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 42, Equations (8), (9), and (10), Section: 2.2.2 Fields Associated with Charges at General Locations, Page 43, Figure 2.2

Dividing the Coulomb force on a test charge by that test charge gives the electric field of a point source charge. At a displacement $\mathbf{R}$ from a charge $Q$, $$\mathbf{E}=\frac{Q}{4\pi\epsilon_0R^2}\mathbf{a}_R.$$ If the charge is placed at the origin of a spherical coordinate system, then $R=r$ and $\mathbf{a}_R=\mathbf{a}_r$, so the field becomes $$\mathbf{E}=\frac{Q}{4\pi\epsilon_0r^2}\mathbf{a}_r.$$ For a charge at a general source point $\mathbf{r}'$ and an observation point $\mathbf{r}$, use $\mathbf{R}=\mathbf{r}-\mathbf{r}'$. Combining the inverse-square magnitude with the normalized displacement produces $$\mathbf{E}(\mathbf{r})=\frac{Q(\mathbf{r}-\mathbf{r}')}{4\pi\epsilon_0|\mathbf{r}-\mathbf{r}'|^3}.$$ This form clearly distinguishes source location from observation location.

### Key planning details

- A point charge produces an inverse-square electric field.
- The field direction is along the source-to-observation displacement.
- At the origin, the field has only a spherical radial component.
- For a general source location, define $\mathbf{R}=\mathbf{r}-\mathbf{r}'$.
- The vector numerator contributes one power of distance, producing a cubic distance norm in the denominator.
- Positive charges produce outward fields and negative charges produce inward fields.
- The notation $\mathbf{E}(\mathbf{r})$ emphasizes that the field is a function of observation position.

### Source coverage

- Equation (8) gives $\mathbf{E}=Q\mathbf{a}_R/(4\pi\epsilon_0R^2)$.
- Equation (9) gives the origin-centered spherical form $\mathbf{E}=Q\mathbf{a}_r/(4\pi\epsilon_0r^2)$.
- Section 2.2.2 defines the source point $\mathbf{r}'$ and observation point $\mathbf{r}$.
- Equation (10) gives $\mathbf{E}(\mathbf{r})=Q(\mathbf{r}-\mathbf{r}')/[4\pi\epsilon_0|\mathbf{r}-\mathbf{r}'|^3]$.
- Equation (10) expands the displacement and distance explicitly in rectangular coordinates.
- Figure 2.2 depicts $\mathbf{r}'$, $\mathbf{r}$, and $\mathbf{R}=\mathbf{r}-\mathbf{r}'$.
