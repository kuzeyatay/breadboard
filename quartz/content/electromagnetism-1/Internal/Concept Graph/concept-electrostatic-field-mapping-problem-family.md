---
title: "Electrostatic Field-Mapping Problem Family"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "electrostatic-field-mapping-problem-family"
locations: ["Page 189", "Page 190", "Page 192"]
related: ["curvilinear-square-field-map-construction", "capacitance-estimation-from-a-flux-plot", "practical-field-map-refinement-procedure", "cylindrical-one-dimensional-potential-solutions"]
---

## ConceptNode: Electrostatic Field-Mapping Problem Family

Planning node for [[electrostatic-field-mapping-problem-family|1.99 Electrostatic Field-Mapping Problem Family]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 189, Page 190, Page 192

A group of end-of-chapter tasks applies curvilinear-square mapping to conductor geometries that do not have simple one-dimensional analytic solutions. The required procedure is to draw the conductor boundaries accurately, use symmetry where available, construct orthogonal equipotential and flux-line families, and estimate capacitance from the ratio $N_Q/N_V$. Exact formulas or known solutions are then used as checks where available. Geometries include coaxial cylinders, parallel circular cylinders, eccentric cylinders, a circular conductor inside a rectangular conductor, and displaced square conductors. The tasks test whether a map preserves boundary normality, orthogonality, and reasonable curvilinear-square proportions in crowded and weak-field regions. They also reinforce scale invariance: changing all transverse dimensions by the same factor does not necessarily change capacitance per unit length for a fixed two-dimensional shape and homogeneous material. Source figures provide boundary geometry for the displaced square transmission line and the radial-plane capacitor problem.

### Key planning details

- Accurate conductor boundaries are established before field lines are drawn.
- Symmetry can reduce the required drawing area.
- Flux lines meet conductor surfaces normally.
- Capacitance is estimated by counting flux tubes and voltage intervals.
- Analytic formulas are used to check graphical estimates.
- Eccentric and polygonal geometries require iterative map refinement.
- Uniform geometric scaling can be tested through capacitance-per-length comparisons.

### Source coverage

- Problem 6.17 requests mapped and exact capacitance values for a coaxial capacitor.
- Problem 6.18 requests a map for two equal parallel circular cylinders.
- Problem 6.19 supplies $$C=\frac{2\pi\epsilon}{\cosh^{-1}[(a^2+b^2-D^2)/(2ab)]}$$ for eccentric circular conductors.
- Problem 6.20 maps a circular conductor inside a rectangular conductor.
- S1.P190.F1, Figure 6.13 defines displaced square inner and outer conductors for Problem 6.21.
- Problem 6.21 asks how changing $a$ affects the mapped capacitance per meter.
- S1.P192.F1, Figure 6.14 defines radial conducting planes for Problem 6.39.
