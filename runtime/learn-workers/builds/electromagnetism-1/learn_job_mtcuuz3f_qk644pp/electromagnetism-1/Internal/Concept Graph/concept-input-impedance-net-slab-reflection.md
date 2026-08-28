---
title: "Input Impedance and Net Slab Reflection"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "input-impedance-net-slab-reflection"
locations: ["Page 434", "Page 435", "Section 12.3.2: Wave Impedance"]
related: ["finite-dielectric-slab-two-interface-system", "half-wave-matching", "quarter-wave-matching-antireflection-coatings", "recursive-impedance-transformation-multilayers"]
---

## ConceptNode: Input Impedance and Net Slab Reflection

Planning node for [[input-impedance-net-slab-reflection|1.253 Input Impedance and Net Slab Reflection]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 434, Page 435, Section 12.3.2: Wave Impedance

Tangential electric and magnetic fields must be continuous at the slab's front interface. Applying these conditions at $z=-l$ connects the incident and reflected amplitudes in region 1 to the total fields inside region 2. The wave impedance evaluated at this location is defined as the slab input impedance, $\eta_{\mathrm{in}}=\eta_w(-l)$. Solving the two boundary equations eliminates the unknown internal field and produces a familiar impedance reflection formula, $\Gamma=(\eta_{\mathrm{in}}-\eta_1)/(\eta_{\mathrm{in}}+\eta_1)$. For the finite lossless layer, the input impedance depends on the intrinsic impedances $\eta_2$ and $\eta_3$, the phase constant $\beta_2$, and the thickness $l$. Thus, both material properties and electrical thickness determine the reflected amplitude and phase. The reflected power fraction is $|\Gamma|^2$, while losslessness implies that the transmitted power fraction is $1-|\Gamma|^2$. Although power continually exits region 2 into reflected and transmitted waves, the incident wave replenishes it, so the power stored and flowing within the slab remains steady in the steady-state description.

### Key planning details

- Tangential $E$ and $H$ are continuous at the first interface.
- The slab input impedance is $\eta_{\mathrm{in}}=\eta_w(-l)$.
- The net amplitude reflection coefficient is $\Gamma=(\eta_{\mathrm{in}}-\eta_1)/(\eta_{\mathrm{in}}+\eta_1)$.
- The input impedance depends on $\eta_2$, $\eta_3$, $\beta_2$, and $l$.
- The reflected power fraction is $|\Gamma|^2$.
- For lossless media, the transmitted power fraction is $1-|\Gamma|^2$.

### Source coverage

- Equations (33a) and (33b) impose tangential-field continuity at $z=-l$.
- Equations (34a) and (34b) express the boundary conditions using $E_{x10}^{+}$, $E_{x10}^{-}$, and $\eta_w(-l)$.
- Equation (35) gives $$\Gamma=\frac{E_{x10}^{-}}{E_{x10}^{+}}=\frac{\eta_{\mathrm{in}}-\eta_1}{\eta_{\mathrm{in}}+\eta_1}.$$
- Evaluation of Equation (32) at $z=-l$ gives $$\eta_{\mathrm{in}}=\eta_2\frac{\eta_3\cos(\beta_2l)+j\eta_2\sin(\beta_2l)}{\eta_2\cos(\beta_2l)+j\eta_3\sin(\beta_2l)}.$$
- Page 435 states that Equations (35) and (36) determine the net reflected amplitude and phase for two parallel interfaces between lossless media.
- Page 435 identifies $|\Gamma|^2$ and $1-|\Gamma|^2$ as the reflected and transmitted power fractions.
