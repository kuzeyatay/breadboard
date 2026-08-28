---
title: "Current Source Representations"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "current-source-representations"
locations: ["Page 197", "Section 7.1.2: Integral Form of the Biot-Savart Law", "Figure S1.P197.F1"]
related: ["integral-biot-savart-law-closed-steady-currents", "magnetic-field-infinite-current-sheet", "magnetic-field-within-coaxial-cable", "differential-biot-savart-law"]
---

## ConceptNode: Current Source Representations

Planning node for [[current-source-representations|1.104 Current Source Representations]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 197, Section 7.1.2: Integral Form of the Biot-Savart Law, Figure S1.P197.F1

The Biot-Savart law can be written for filamentary, surface, or volume current distributions. A surface current occupies an ideal sheet of vanishing thickness, for which ordinary volume current density would become unbounded. Its finite source measure is the surface current density $\mathbf{K}$, measured in amperes per meter of width. If $\mathbf{K}$ is uniform and the transverse width is $b$, the total current is $I=Kb$. More generally,

$$I=\int K\,dN,$$

where $dN$ crosses the direction of current flow. The three differential source representations are related by

$$I\,d\mathbf{L}=\mathbf{K}\,dS=\mathbf{J}\,dv.$$

Substitution into the Biot-Savart law produces

$$\mathbf{H}=\int_S\frac{\mathbf{K}\times\mathbf{a}_R}{4\pi R^2}\,dS$$

and

$$\mathbf{H}=\int_V\frac{\mathbf{J}\times\mathbf{a}_R}{4\pi R^2}\,dv.$$

Choosing among these forms depends on whether the physical source is best idealized as a filament, sheet, or three-dimensional current distribution.

### Key planning details

- Volume current density $\mathbf{J}$ is measured in A/m$^2$.
- Surface current density $\mathbf{K}$ is measured in A/m of transverse width.
- For uniform surface current, $I=Kb$.
- For nonuniform surface current, $I=\int K\,dN$.
- The source elements satisfy $I\,d\mathbf{L}=\mathbf{K}\,dS=\mathbf{J}\,dv$.
- Surface and volume Biot-Savart integrals follow by direct substitution.

### Source coverage

- Figure S1.P197.F1 shows that uniform surface current density $K$ across width $b$ carries total current $Kb$.
- Page 197 defines surface current density as current per meter width.
- Page 197 specifies that the width is measured perpendicular to current flow.
- Page 197 gives $I\,d\mathbf{L}=\mathbf{K}\,dS=\mathbf{J}\,dv$.
- Page 197 gives the surface-current Biot-Savart integral.
- Page 197 gives the volume-current Biot-Savart integral.
