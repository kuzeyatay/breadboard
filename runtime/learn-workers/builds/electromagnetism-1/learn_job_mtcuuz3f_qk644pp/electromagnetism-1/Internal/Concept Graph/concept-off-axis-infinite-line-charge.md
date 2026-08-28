---
title: "Off-Axis Infinite Line Charge"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "off-axis-infinite-line-charge"
locations: ["Page 50", "Page 51", "Section: 2.4.2 Field of an Off-Axis Line Charge"]
related: ["derivation-and-distance-scaling-of-the-infinite-line-field", "superposition-of-point-charge-electric-fields", "multipoles-finite-charge-distributions-and-far-field-limits"]
---

## ConceptNode: Off-Axis Infinite Line Charge

Planning node for [[off-axis-infinite-line-charge|1.44 Off-Axis Infinite Line Charge]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 50, Page 51, Section: 2.4.2 Field of an Off-Axis Line Charge

The standard infinite-line result can be translated to a line parallel to the $z$ axis but displaced in the transverse plane. For a line through $(x_0,y_0)$ and an observation point $(x,y,z)$, the transverse displacement is $\mathbf{R}=(x-x_0)\mathbf{a}_x+(y-y_0)\mathbf{a}_y$. Its magnitude replaces the cylindrical radius measured from the original axis, and $\mathbf{a}_R=\mathbf{R}/|\mathbf{R}|$ replaces $\mathbf{a}_\rho$. Substituting these quantities into the infinite-line formula produces a Cartesian expression with denominator $R^2$. The field remains independent of $z$ because shifting either the source or observation point along an infinite uniform line does not change the geometry. This translated-vector method is reusable for multiple parallel line charges because each line can be handled with its own transverse displacement and then combined by superposition.

### Key planning details

- Measure radial distance from the actual line, not from the coordinate-system axis.
- For a line through $(x_0,y_0)$, $R=\sqrt{(x-x_0)^2+(y-y_0)^2}$.
- The direction is the normalized transverse displacement from the line to the field point.
- The field has no $z$ component and no $z$ dependence.
- Fields from several displaced lines can be added by vector superposition.

### Source coverage

- The worked geometry uses an infinite line parallel to $z$ at $x=6$, $y=8$.
- For that line, $R=\sqrt{(x-6)^2+(y-8)^2}$.
- The unit vector is $$\mathbf{a}_R=\frac{(x-6)\mathbf{a}_x+(y-8)\mathbf{a}_y}{\sqrt{(x-6)^2+(y-8)^2}}.$$
- The resulting field is $$\mathbf{E}=\frac{\rho_L}{2\pi\epsilon_0}\frac{(x-6)\mathbf{a}_x+(y-8)\mathbf{a}_y}{(x-6)^2+(y-8)^2}.$$
- Source figure S1.P50.F1, Figure 2.7, identifies the displaced line and general point $P(x,y,z)$.
- Drill D2.5 uses superposition for uniform line charges on the $x$ and $y$ axes.
