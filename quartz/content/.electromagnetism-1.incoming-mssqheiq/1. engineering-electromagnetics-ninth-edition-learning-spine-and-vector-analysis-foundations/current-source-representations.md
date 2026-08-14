---
title: "1.104 Current Source Representations"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 197", "Section 7.1.2: Integral Form of the Biot-Savart Law", "Figure S1.P197.F1"]
related: ["integral-biot-savart-law-closed-steady-currents", "magnetic-field-infinite-current-sheet", "magnetic-field-within-coaxial-cable", "differential-biot-savart-law"]
---

# 1.104 Current Source Representations

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 197, Section 7.1.2: Integral Form of the Biot-Savart Law, Figure S1.P197.F1

The Biot-Savart law can be written for filamentary, surface, or volume current distributions. A surface current occupies an ideal sheet of vanishing thickness, for which ordinary volume current density would become unbounded. Its finite source measure is the surface current density $\mathbf{K}$, measured in amperes per meter of width. If $\mathbf{K}$ is uniform and the transverse width is $b$, the total current is $I=Kb$. More generally,
$$
I=\int K\,dN
$$
where $dN$ crosses the direction of current flow. The three differential source representations are related by
$$
I\,d\mathbf{L}=\mathbf{K}\,dS=\mathbf{J}\,dv
$$
Substitution into the Biot-Savart law produces
$$
\mathbf{H}=\int_S\frac{\mathbf{K}\times\mathbf{a}_R}{4\pi R^2}\,dS
$$
and
$$
\mathbf{H}=\int_V\frac{\mathbf{J}\times\mathbf{a}_R}{4\pi R^2}\,dv
$$
Choosing among these forms depends on whether the physical source is best idealized as a filament, sheet, or three-dimensional current distribution.

## Page-Grounded Details

#### Page 197

Figure 7.2 The total current $I$ within a transverse width $b$, in which there is a uniform surface current density $K$, is $Kb$.

The Biot-Savart law may also be expressed in terms of distributed sources, such as current density $\mathbf{J}$ and *surface current density* $\mathbf{K}$. Surface current flows in a sheet of vanishingly small thickness, and the current density $\mathbf{J}$, measured in amperes per square meter, is therefore infinite. Surface current density, however, is measured in amperes per meter width and designated by $\mathbf{K}$. If the surface current density is uniform, the total current $I$ in any width $b$ is
$$
I=Kb
$$
where we assume that the width $b$ is measured perpendicularly to the direction in which the current is flowing. The geometry is illustrated by Figure 7.2. For a nonuniform surface current density, integration is necessary:
$$
I=\int KdN \quad{(4)}
$$
where $dN$ is a differential element of the path *across* which the current is flowing. Thus the differential current element $I\ d\mathbf{L}$, where $d\mathbf{L}$ is in the direction of the current, may be expressed in terms of surface current density $ \mathbf{K

[Truncated for analysis]

## Core Ideas

- Volume current density $\mathbf{J}$ is measured in A/m$^2$.
- Surface current density $\mathbf{K}$ is measured in A/m of transverse width.
- For uniform surface current, $I=Kb$.
- For nonuniform surface current, $I=\int K\,dN$.
- The source elements satisfy $I\,d\mathbf{L}=\mathbf{K}\,dS=\mathbf{J}\,dv$.
- Surface and volume Biot-Savart integrals follow by direct substitution.

## Source Anchors

- Figure S1.P197.F1 shows that uniform surface current density $K$ across width $b$ carries total current $Kb$.
- Page 197 defines surface current density as current per meter width.
- Page 197 specifies that the width is measured perpendicular to current flow.
- Page 197 gives $I\,d\mathbf{L}=\mathbf{K}\,dS=\mathbf{J}\,dv$.
- Page 197 gives the surface-current Biot-Savart integral.
- Page 197 gives the volume-current Biot-Savart integral.

## Related Pages

- [[integral-biot-savart-law-closed-steady-currents|Integral Biot-Savart Law and Closed Steady Currents]]
- [[magnetic-field-infinite-current-sheet|Magnetic Field of an Infinite Current Sheet]]
- [[magnetic-field-within-coaxial-cable|Magnetic Field Within a Coaxial Cable]]
- [[differential-biot-savart-law|Differential Biot-Savart Law]]

## Concept Dependencies

- derives-from: [[differential-biot-savart-law|Differential Biot-Savart Law]]
