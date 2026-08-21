---
title: "General Transmission-Line Wave Equations"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "general-transmission-line-wave-equations"
locations: ["Page 320", "Page 321", "Section 10.2: The Transmission Line Equations", "Section 10.3: Lossless Propagation"]
related: ["telegraphists-equations", "lossless-traveling-wave-solutions", "per-unit-length-transmission-line-model", "maxwell-equation-application-problems"]
---

## ConceptNode: General Transmission-Line Wave Equations

Planning node for [[general-transmission-line-wave-equations|1.165 General Transmission-Line Wave Equations]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 320, Page 321, Section 10.2: The Transmission Line Equations, Section 10.3: Lossless Propagation

The coupled telegraphist's equations can be decoupled by differentiating and substitution. Differentiating the voltage equation with respect to $z$, differentiating the current equation with respect to $t$, and eliminating current derivatives yields $$\frac{\partial^2V}{\partial z^2}=LC\frac{\partial^2V}{\partial t^2}+(LG+RC)\frac{\partial V}{\partial t}+RGV.$$ An analogous procedure gives $$\frac{\partial^2I}{\partial z^2}=LC\frac{\partial^2I}{\partial t^2}+(LG+RC)\frac{\partial I}{\partial t}+RGI.$$ The $LC$ term supports propagation through distributed energy storage. The first-time-derivative term contains the combined loss effects $LG+RC$, while the $RG$ term couples both dissipative mechanisms directly to the field variable. These are the general wave equations for a uniform line and form the basis for both lossless and lossy propagation analysis.

### Key planning details

- Differentiate and substitute to eliminate one of the two line variables.
- Voltage and current satisfy wave equations of identical mathematical form.
- The $LC$ term controls the second-time-derivative propagation behavior.
- The $LG+RC$ and $RG$ terms arise from line losses.
- Setting $R=G=0$ reduces the equations to the lossless wave equation.

### Source coverage

- Equations (9) and (10) on Page 320 are intermediate differentiated forms.
- Equation (11) gives the general voltage wave equation.
- Equation (12) gives the general current wave equation.
- Page 320 identifies Equations (11) and (12) as the general transmission-line wave equations.
