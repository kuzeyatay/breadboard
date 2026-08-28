---
title: "Ampere's Circuital Law and Enclosed Current"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "ampere-circuital-law-enclosed-current"
locations: ["Page 202", "Page 203", "Section 7.2: Ampere's Circuital Law", "Section 7.2.1: Definition of Ampere's Law", "Figure S1.P203.F1"]
related: ["integral-biot-savart-law-closed-steady-currents", "ampere-circuital-law-applied-filament", "magnetic-field-within-coaxial-cable", "curl-circulation-per-unit-area"]
---

## ConceptNode: Ampere's Circuital Law and Enclosed Current

Planning node for [[ampere-circuital-law-enclosed-current|1.107 Ampere's Circuital Law and Enclosed Current]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 202, Page 203, Section 7.2: Ampere's Circuital Law, Section 7.2.1: Definition of Ampere's Law, Figure S1.P203.F1

Ampere's circuital law states that the circulation of magnetic field intensity around any closed path equals the algebraic direct current enclosed by that path:

$$\oint\mathbf{H}\cdot d\mathbf{L}=I_{\mathrm{encl}}.$$

Positive current is defined by the right-hand relationship between the traversal direction and the surface normal. The enclosed current is not determined merely by whether a wire appears geometrically near the path. A closed path bounds many possible open surfaces, and the enclosed current is the algebraic current piercing any such surface. If a conductor passes through a surface once in each direction, the two contributions cancel. Different closed paths enclosing the same current can have different point-by-point integrands but the same final circulation. The law is analogous to Gauss's law: Gauss's law relates flux through a closed surface to enclosed charge, while Ampere's law relates circulation around a closed path to current piercing a bounded surface.

### Key planning details

- Ampere's law is $\oint\mathbf{H}\cdot d\mathbf{L}=I_{\mathrm{encl}}$.
- Path orientation and positive current direction are linked by the right-hand rule.
- Current enclosed means algebraic current piercing a surface bounded by the path.
- The same boundary admits many surfaces, but each yields the same net piercing current.
- Oppositely directed crossings cancel algebraically.
- Different paths can produce different local integrands while giving the same total circulation.
- Ampere's law is especially efficient when the source has high symmetry.

### Source coverage

- Page 202 introduces Ampere's circuital law as the magnetic analogue of using Gauss's law for symmetric electrostatic problems.
- Page 202 gives $\oint\mathbf{H}\cdot d\mathbf{L}=I$.
- Figure S1.P203.F1 shows paths $a$ and $b$ enclosing the total current and path $c$ enclosing only part of it.
- Page 203 uses a deformable loop and spanning sheet to explain current enclosed by a path.
- Page 203 states that opposite-direction surface crossings contribute an algebraic total of zero.
- Page 203 contrasts charge enclosed by a closed surface with current enclosed by a closed path.
