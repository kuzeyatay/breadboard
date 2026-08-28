---
title: "Voltage and Current Reflection Diagrams"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "voltage-and-current-reflection-diagrams"
locations: ["Page 362", "Page 363", "Page 364", "Page 365"]
related: ["multiple-reflections-and-transient-steady-state", "worked-transient-with-a-matched-generator", "initially-charged-lines-and-pulse-formation"]
---

## ConceptNode: Voltage and Current Reflection Diagrams

Planning node for [[voltage-and-current-reflection-diagrams|1.203 Voltage and Current Reflection Diagrams]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 362, Page 363, Page 364, Page 365

A reflection diagram records where each wavefront is located as time advances. Position lies on the horizontal axis and time on the vertical axis, with diagonal lines representing propagation at velocity $v$. A forward wave travels from generator to load in $l/v$; its reflection returns in another $l/v$. To find voltage at a fixed location, draw a vertical reference line and add each wave voltage when its diagonal crosses that reference. This gives both the accumulated voltage and the exact time of each change. Current diagrams use the same wave paths but require a direction-dependent sign convention. For a forward-traveling voltage wave, $$I^+=\frac{V^+}{Z_0}.$$ For a backward-traveling voltage wave, $$I^-=-\frac{V^-}{Z_0}.$$ The minus sign is essential because a positive-polarity backward voltage wave carries current in the negative reference direction. Once each voltage wave is converted independently into its associated current wave, current at any location is found by the same crossing-and-summing procedure.

### Key planning details

- Plot position horizontally and time vertically.
- A one-way diagonal spans time $l/v$.
- Each reflection reverses the wave's direction on the diagram.
- Draw a vertical line at the observation position.
- Add a wave when its trajectory crosses the observation line.
- Use $I^+=V^+/Z_0$ for forward waves.
- Use $I^-=-V^-/Z_0$ for backward waves.
- Construct each current wave from its corresponding voltage wave rather than from another current wave.

### Source coverage

- Source figure S1.P363.F1, Figure 10.21a, shows a voltage reflection diagram with a reference line at $z=3l/4$.
- Source figure S1.P363.F2, Figure 10.21b, shows voltage versus time at $z=3l/4$.
- Page 364 explains the crossing-and-summing procedure for voltage.
- Page 364 gives $I^+=V^+/Z_0$ and $I^-=-V^-/Z_0$ as Eqs. (120) and (121).
- Source figure S1.P365.F1, Figure 10.22a, derives the current reflection diagram from the voltage diagram.
- Source figure S1.P365.F2, Figure 10.22b, shows current versus time at $z=3l/4$.
- Page 365 identifies the expected current limit as $V_0/(R_L+R_g)$.
