---
title: "1.46 Parallel-Plate Capacitor Field"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 53", "Section: 2.5.3 Capacitor Model"]
related: ["field-of-an-infinite-uniform-sheet", "superposition-of-point-charge-electric-fields", "electric-flux-density-from-charge"]
---

# 1.46 Parallel-Plate Capacitor Field

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 53, Section: 2.5.3 Capacitor Model

Two oppositely charged infinite sheets model the central region of a parallel-plate air capacitor. One sheet lies at $x=0$ with density $+\rho_S$, and the other lies at $x=a$ with density $-\rho_S$. Each sheet independently produces a field of magnitude $\rho_S/(2\epsilon_0)$ directed away from positive charge or toward negative charge. Outside the pair, the two contributions point in opposite directions and cancel. Between the sheets, they point in the same direction and add, producing $\mathbf{E}=(\rho_S/\epsilon_0)\mathbf{a}_x$. Real plates are finite, so exact cancellation outside and exact uniformity inside do not hold near their edges. The ideal result is a good approximation when plate dimensions greatly exceed the separation and the observation point is well away from edge fringing.

## Page-Grounded Details

#### Page 53

on a square foot a few inches below the ceiling. If you desire greater illumination on this subject, it will do you no good to hold the book closer to such a light source.

#### 2.5.3 Capacitor Model

If a second infinite sheet of charge, having a negative charge density $-\rho_{S}$, is located in the plane $x = a$, the total field may be found by adding the contribution of each sheet. In the region $x > a$,
$$
E_{+}=\frac{\rho_{S}}{2\,\epsilon_{0}}a_{x} \quad E_{-}=-\frac{\rho_{S}}{2\,\epsilon_{0}}a_{x} \quad E=E_{+}+E_{-}=0
$$
and for $x < 0$,
$$
E_{+}=-\frac{\rho_{S}}{2\,\epsilon_{0}}a_{x} \quad E_{-}=\frac{\rho_{S}}{2\,\epsilon_{0}}a_{x} \quad E=E_{+}+E_{-}=0
$$
and when $0 < x < a$,
$$
E_{+}=\frac{\rho_{S}}{2\,\epsilon_{0}}a_{x} \quad E_{-}=\frac{\rho_{S}}{2\,\epsilon_{0}}a_{x}
$$
and
$$
E=E_{+}+E_{-}=\frac{\rho_{S}}{\epsilon_{0}}a_{x}
$$
This is an important practical answer, for it is the field between the parallel plates of an air capacitor, provided the linear dimensions of the plates are very much greater than their separation and provided also that we are considering a point well removed from the edges. The field outside the capacitor, while not zero, a

[Truncated for analysis]

## Core Ideas

- Each isolated sheet contributes magnitude $\rho_S/(2\epsilon_0)$.
- The two fields cancel outside ideal oppositely charged sheets.
- The fields reinforce between the sheets.
- The interior ideal field is $\rho_S/\epsilon_0$.
- The field points from the positive plate toward the negative plate.
- Finite-plate edge effects limit the ideal approximation.

## Source Anchors

- The positive sheet is at $x=0$ and the negative sheet is at $x=a$.
- For $x>a$, the contributions sum to zero.
- For $x<0$, the contributions also sum to zero.
- For $0<x<a$,
$$
\mathbf{E}=\frac{\rho_S}{\epsilon_0}\mathbf{a}_x
$$
- The source states that the result models an air capacitor when plate dimensions are much larger than their separation.
- Drill D2.6 requires piecewise superposition of fields from three infinite charged sheets.

## Related Pages

- [[field-of-an-infinite-uniform-sheet|Field of an Infinite Uniform Sheet]]
- [[superposition-of-point-charge-electric-fields|Superposition of Point-Charge Electric Fields]]
- [[electric-flux-density-from-charge|Electric Flux Density from Charge]]

## Concept Dependencies

- derives-from: [[field-of-an-infinite-uniform-sheet|Field of an Infinite Uniform Sheet]]
- related: [[superposition-of-point-charge-electric-fields|Superposition of Point-Charge Electric Fields]]
