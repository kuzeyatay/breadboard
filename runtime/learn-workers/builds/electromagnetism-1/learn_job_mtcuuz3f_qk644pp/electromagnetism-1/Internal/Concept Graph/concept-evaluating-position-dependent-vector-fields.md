---
title: "Evaluating Position-Dependent Vector Fields"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "evaluating-position-dependent-vector-fields"
locations: ["Page 20"]
related: ["scalar-and-vector-fields", "rectangular-vector-components-and-unit-vectors", "vector-magnitude-and-normalization", "dot-product-as-scalar-projection", "directional-projection-worked-procedure"]
---

## ConceptNode: Evaluating Position-Dependent Vector Fields

Planning node for [[evaluating-position-dependent-vector-fields|1.12 Evaluating Position-Dependent Vector Fields]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 20

A vector field in rectangular coordinates is evaluated by substituting a point's coordinate values into each component function. In general, $$\mathbf{v}(\mathbf{r})=v_x(\mathbf{r})\mathbf{a}_x+v_y(\mathbf{r})\mathbf{a}_y+v_z(\mathbf{r})\mathbf{a}_z,$$ and each component may depend on $x$, $y$, and $z$. The ocean-current example chooses $z$ upward, $x$ northward, and $y$ westward, producing a right-handed frame. In a simplified region where flow is only northward and decreases with depth, the field is $$\mathbf{v}=2e^{z/100}\mathbf{a}_x.$$ At the surface, where $z=0$, the speed is $2$ m/s. At a depth of $100$ m, where $z=-100$, the speed is $2e^{-1}=0.736$ m/s. Direction remains fixed along $\mathbf{a}_x$ while magnitude decreases with depth. Drill problem D1.2 generalizes field evaluation by asking for a field value, its unit direction, and a constant-magnitude surface.

### Key planning details

- Each field component can be a function of position.
- Field evaluation substitutes a point's coordinates into all component functions.
- Some components may be identically zero under physical assumptions.
- A field can vary in magnitude while retaining constant direction.
- The field $2e^{z/100}\mathbf{a}_x$ decreases with increasing depth.
- At $z=0$, the example field has magnitude $2$ m/s.
- At $z=-100$ m, its magnitude is $0.736$ m/s.

### Source coverage

- The general field notation is $\mathbf{v}(\mathbf{r})=v_x(\mathbf{r})\mathbf{a}_x+v_y(\mathbf{r})\mathbf{a}_y+v_z(\mathbf{r})\mathbf{a}_z$.
- The ocean-current coordinates use $z$ upward, $x$ northward, and $y$ westward.
- The simplified current is $\mathbf{v}=2e^{z/100}\mathbf{a}_x$.
- The source evaluates the field as $2$ m/s at the surface and $0.736$ m/s at $100$ m depth.
- D1.2 asks for a field value at $P(2,4,3)$, a unit direction, and the surface on which the magnitude equals one.
