---
title: "Nonlinear Gapped Magnetic Circuit Analysis"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "nonlinear-gapped-magnetic-circuit-analysis"
locations: ["Page 273", "Page 274", "Page 275", "Section 8.8", "Example 8.7", "Example 8.8", "Figure 8.13", "Problems D8.9 and D8.10"]
related: ["magnetic-circuit-analogy-and-reluctance", "ferromagnetic-magnetization-and-hysteresis", "magnetic-field-energy-and-air-gap-force", "air-core-toroid-circuit-calculation"]
---

## ConceptNode: Nonlinear Gapped Magnetic Circuit Analysis

Planning node for [[nonlinear-gapped-magnetic-circuit-analysis|1.127 Nonlinear Gapped Magnetic Circuit Analysis]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 273, Page 274, Page 275, Section 8.8, Example 8.7, Example 8.8, Figure 8.13, Problems D8.9 and D8.10

A magnetic circuit containing ferromagnetic steel and an air gap is analogous to a series circuit with one nonlinear element. When the desired flux density is given, the same flux passes through the steel and gap if leakage and fringing are neglected. Example 8.7 specifies $B=1$ T, a 2 mm air gap, a $6\,\mathrm{cm}^2$ cross section, a steel path of approximately $0.30\pi$ m, and 500 turns. The gap reluctance is $2.65\times10^6$ A-turn/Wb, the flux is $6\times10^{-4}$ Wb, and the gap requires 1590 A-turn. Figure 8.11 indicates that the steel requires $H=200$ A/m at 1 T, so its mmf drop is 188 A-turn. The total is 1778 A-turn, requiring 3.56 A. For the reverse problem in Example 8.8, a specified current gives total mmf while the nonlinear flux density is unknown. A straight-line approximation gives 1.13 T, while trial values and interpolation give 1.10 T. The air-gap reluctance dominates, allowing a comparatively crude steel model to remain useful.

### Key planning details

- Series magnetic sections carry approximately the same flux when leakage is neglected.
- Each linear section has mmf drop $V_m=\Phi\mathcal{R}=Hd$.
- A nonlinear steel section requires its magnetization curve rather than a constant permeability.
- The total coil mmf equals the sum of the section mmf drops.
- An air gap can dominate the total reluctance even when it is physically short.
- Given flux density, the steel $H$ value can be read from the magnetization curve.
- Given current, nonlinear solutions can use trial values, plotting, and interpolation.
- Fringing, leakage, unequal path lengths, and nonuniform cross sections limit accuracy.

### Source coverage

- Example 8.7 uses a 2 mm air gap, 500 turns, and desired $B=1$ T.
- The air-gap reluctance is $2.65\times10^6$ A-turn/Wb and its mmf drop is 1590 A-turn.
- At $B=1$ T, Figure 8.11 gives $H_{steel}=200$ A/m, producing a steel mmf drop of 188 A-turn.
- The total mmf is 1778 A-turn and the required current is 3.56 A.
- Example 8.8 obtains 1.13 T from a linearized model and 1.10 T from trial calculations and interpolation.
- The source identifies nonuniform path length, gap fringing, and leakage flux as approximation errors.
- Figure S13.P275.F8.13 supports Problem D8.9, which partitions mmf into air and steel contributions.
- Problem D8.10 supplies a nonlinear law $B=(H/160)(0.25+e^{-H/320})$ for material X.
