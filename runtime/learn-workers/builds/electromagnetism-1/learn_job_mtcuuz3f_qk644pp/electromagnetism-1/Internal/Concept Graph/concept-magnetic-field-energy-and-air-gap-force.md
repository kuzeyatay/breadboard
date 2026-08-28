---
title: "Magnetic Field Energy and Air-Gap Force"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "magnetic-field-energy-and-air-gap-force"
locations: ["Page 275", "Page 276", "Page 277", "Section 8.9", "Problem D8.11"]
related: ["nonlinear-gapped-magnetic-circuit-analysis", "energy-and-vector-potential-definitions-of-inductance", "flux-linkage-and-self-inductance"]
---

## ConceptNode: Magnetic Field Energy and Air-Gap Force

Planning node for [[magnetic-field-energy-and-air-gap-force|1.128 Magnetic Field Energy and Air-Gap Force]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 275, Page 276, Page 277, Section 8.9, Problem D8.11

For a steady magnetic field in a linear medium, the stored energy is $W_H=(1/2)\int_{vol}\mathbf{B}\cdot\mathbf{H}\,dv$. If $\mathbf{B}=\mu\mathbf{H}$, equivalent forms are $W_H=(1/2)\int_{vol}\mu H^2\,dv$ and $W_H=(1/2)\int_{vol}B^2/\mu\,dv$. The associated energy density is treated as $w_H=(1/2)\mathbf{B}\cdot\mathbf{H}$ J/m$^3$. The source cautions that a direct mechanical derivation using moving current sheets is incomplete because Faraday induction transfers part of the work to the current source. Nevertheless, the linear energy formulas can calculate forces on nonlinear magnetic materials by focusing on the surrounding linear air. If two steel core sections are separated by a differential distance while flux density remains constant, the mechanical work $F\,dL$ equals the increase in air-gap energy. For core area $S$, this gives $F=B_{st}^2S/(2\mu_0)$. At a saturated steel flux density of about 1.4 T, the pressure is approximately $7.80\times10^5$ N/m$^2$, or 113 lbf/in$^2$.

### Key planning details

- Linear magnetic energy is $W_H=(1/2)\int\mathbf{B}\cdot\mathbf{H}\,dv$.
- For $\mathbf{B}=\mu\mathbf{H}$, energy may be written using either $H^2$ or $B^2$.
- Magnetic energy density is $w_H=(1/2)\mathbf{B}\cdot\mathbf{H}$.
- A naive moving-current-sheet derivation omits energy exchanged with the current source.
- Virtual work can evaluate forces by tracking energy added to a linear air gap.
- At constant flux density, gap force is $F=B^2S/(2\mu_0)$.
- The force acts to reduce the air gap.

### Source coverage

- Equation (46) gives $W_H=(1/2)\int_{vol}\mathbf{B}\cdot\mathbf{H}\,dv$.
- Equations (47) and (48) give the equivalent $\mu H^2$ and $B^2/\mu$ forms.
- Pages 275 and 276 explain why Faraday induction complicates a direct mechanical derivation.
- Page 277 equates $F\,dL$ to $(1/2)(B_{st}^2/\mu_0)S\,dL$.
- The resulting force formula is $F=B_{st}^2S/(2\mu_0)$.
- For $B_{st}\approx1.4$ T, the source gives $F=7.80\times10^5S$ N.
- Problem D8.11 reports a 1194 N force that tends to close the air gap.
