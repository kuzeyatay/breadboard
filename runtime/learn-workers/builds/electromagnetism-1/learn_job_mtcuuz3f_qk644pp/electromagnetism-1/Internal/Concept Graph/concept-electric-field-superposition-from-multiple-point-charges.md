---
title: "Electric Field Superposition from Multiple Point Charges"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "electric-field-superposition-from-multiple-point-charges"
locations: ["Page 42", "Section: 2.2.2 Fields Associated with Charges at General Locations", "Page 43", "Figure 2.3"]
related: ["mutual-force-linearity-and-superposition", "electric-field-intensity-as-force-per-unit-charge", "point-charge-electric-field-at-the-origin-and-general-locations"]
---

## ConceptNode: Electric Field Superposition from Multiple Point Charges

Planning node for [[electric-field-superposition-from-multiple-point-charges|1.36 Electric Field Superposition from Multiple Point Charges]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 42, Section: 2.2.2 Fields Associated with Charges at General Locations, Page 43, Figure 2.3

Because Coulomb's law is linear, the total electric field at an observation point is the vector sum of the fields produced by individual source charges. For charges $Q_1$ at $\mathbf{r}_1$ and $Q_2$ at $\mathbf{r}_2$, the source gives $$\mathbf{E}(\mathbf{r})=\frac{Q_1}{4\pi\epsilon_0|\mathbf{r}-\mathbf{r}_1|^2}\mathbf{a}_1+\frac{Q_2}{4\pi\epsilon_0|\mathbf{r}-\mathbf{r}_2|^2}\mathbf{a}_2,$$ where $\mathbf{a}_1$ and $\mathbf{a}_2$ point from their respective source charges toward the common observation point. Each contribution must use its own displacement, distance, and unit direction before the vectors are added. Figure 2.3 is source-central because it shows the two source positions, the observation point, the two directed displacements, and the geometric vector addition that produces the total field.

### Key planning details

- Compute one electric-field vector for each source charge.
- Use the same observation point for all contributions.
- Each source has its own displacement $\mathbf{r}-\mathbf{r}_i$.
- Each field direction points from its source location toward the observation point before the charge sign is applied.
- Add electric-field contributions component by component.
- Superposition follows from the linearity of Coulomb's law.
- The construction generalizes from two charges to any finite collection and later to continuous distributions.

### Source coverage

- Page 42 states that the field from two point charges is the sum of the fields caused by the charges acting alone.
- The two-charge expression contains separate distances $|\mathbf{r}-\mathbf{r}_1|$ and $|\mathbf{r}-\mathbf{r}_2|$.
- The unit vectors $\mathbf{a}_1$ and $\mathbf{a}_2$ are defined along $\mathbf{r}-\mathbf{r}_1$ and $\mathbf{r}-\mathbf{r}_2$.
- Figure 2.3 depicts the relevant position vectors, displacement vectors, and unit vectors.
- Figure 2.3 explicitly describes vector addition of the total field at P as a consequence of linearity.
