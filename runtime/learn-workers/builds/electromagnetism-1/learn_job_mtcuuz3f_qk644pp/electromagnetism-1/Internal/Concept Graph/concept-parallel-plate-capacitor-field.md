---
title: "Parallel-Plate Capacitor Field"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "parallel-plate-capacitor-field"
locations: ["Page 53", "Section: 2.5.3 Capacitor Model"]
related: ["field-of-an-infinite-uniform-sheet", "superposition-of-point-charge-electric-fields", "electric-flux-density-from-charge"]
---

## ConceptNode: Parallel-Plate Capacitor Field

Planning node for [[parallel-plate-capacitor-field|1.46 Parallel-Plate Capacitor Field]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 53, Section: 2.5.3 Capacitor Model

Two oppositely charged infinite sheets model the central region of a parallel-plate air capacitor. One sheet lies at $x=0$ with density $+\rho_S$, and the other lies at $x=a$ with density $-\rho_S$. Each sheet independently produces a field of magnitude $\rho_S/(2\epsilon_0)$ directed away from positive charge or toward negative charge. Outside the pair, the two contributions point in opposite directions and cancel. Between the sheets, they point in the same direction and add, producing $\mathbf{E}=(\rho_S/\epsilon_0)\mathbf{a}_x$. Real plates are finite, so exact cancellation outside and exact uniformity inside do not hold near their edges. The ideal result is a good approximation when plate dimensions greatly exceed the separation and the observation point is well away from edge fringing.

### Key planning details

- Each isolated sheet contributes magnitude $\rho_S/(2\epsilon_0)$.
- The two fields cancel outside ideal oppositely charged sheets.
- The fields reinforce between the sheets.
- The interior ideal field is $\rho_S/\epsilon_0$.
- The field points from the positive plate toward the negative plate.
- Finite-plate edge effects limit the ideal approximation.

### Source coverage

- The positive sheet is at $x=0$ and the negative sheet is at $x=a$.
- For $x>a$, the contributions sum to zero.
- For $x<0$, the contributions also sum to zero.
- For $0<x<a$, $$\mathbf{E}=\frac{\rho_S}{\epsilon_0}\mathbf{a}_x.$$
- The source states that the result models an air capacitor when plate dimensions are much larger than their separation.
- Drill D2.6 requires piecewise superposition of fields from three infinite charged sheets.
