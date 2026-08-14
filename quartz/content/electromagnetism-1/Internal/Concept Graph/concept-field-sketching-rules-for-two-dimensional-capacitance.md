---
title: "Field-Sketching Rules for Two-Dimensional Capacitance"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "field-sketching-rules-for-two-dimensional-capacitance"
locations: ["Page 168", "Page 169", "Page 170", "Section 6.5: Using Field Sketches to Estimate Capacitance in Two-Dimensional Problems", "Figure 6.6"]
related: ["two-wire-line-field-and-surface-charge", "capacitance-as-a-charge-to-potential-ratio", "parallel-plate-capacitance"]
---

## ConceptNode: Field-Sketching Rules for Two-Dimensional Capacitance

Planning node for [[field-sketching-rules-for-two-dimensional-capacitance|1.85 Field-Sketching Rules for Two-Dimensional Capacitance]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 168, Page 169, Page 170, Section 6.5: Using Field Sketches to Estimate Capacitance in Two-Dimensional Problems, Figure 6.6

For two-dimensional conductor geometries that do not fit a convenient coordinate system, capacitance can be estimated by sketching equipotential surfaces and electric-flux streamlines. The method assumes no field variation normal to the sketch plane and a homogeneous dielectric. Conductors are equipotential boundaries, electric field and flux density are perpendicular to equipotentials, and both fields meet conductor surfaces normally. Flux lines begin and terminate on charge, so in a charge-free dielectric they connect conductor boundaries. Adjacent flux lines form a flux tube through which no flux crosses the sides. The sketch is organized so adjacent equipotentials differ by a constant $\Delta V$ and adjacent streamlines carry a constant flux $\Delta\Psi$. Local field estimates from voltage spacing and flux-tube width are equated: $$\frac{1}{\epsilon}\frac{\Delta\Psi}{\Delta L_t}=\frac{\Delta V}{\Delta L_N}.$$ Therefore, $$\frac{\Delta L_t}{\Delta L_N}=\frac{1}{\epsilon}\frac{\Delta\Psi}{\Delta V}=\text{constant}.$$ The individual spacings shrink in stronger-field regions, but their ratio remains constant. Figures 6.6a and 6.6b illustrate the equipotentials and orthogonal streamlines.

### Key planning details

- The method applies to fields with no variation normal to the sketch plane.
- Conductor boundaries are equipotentials.
- Flux lines and electric field lines cross equipotentials at right angles.
- No electric flux crosses the sides of a flux tube.
- Equipotential increments and flux per tube are held constant.
- The ratio $\Delta L_t/\Delta L_N$ must remain constant throughout the net.

### Source coverage

- The source states that a beginner may obtain about 5 to 10 percent capacitance accuracy.
- Four initial rules identify conductor equipotentials, orthogonal fields, zero tangential conductor fields, and flux-line termination.
- Figure 6.6a shows equal-increment equipotential surfaces between two conductors.
- Figure 6.6b adds streamlines from $A$ to $A'$ and $B$ to $B'$.
- Equation (18) equates the flux-based and voltage-based field estimates.
- Equation (19) requires a constant ratio $\Delta L_t/\Delta L_N$.
- Visual opportunity S1.P169.F1: recreate Figure 6.6 as an editable orthogonal flux net with cell-ratio feedback.
