---
title: "Finite Dielectric Slab as a Two-Interface System"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "finite-dielectric-slab-two-interface-system"
locations: ["Page 433", "Page 434", "Section 12.3.2: Wave Impedance"]
related: ["input-impedance-net-slab-reflection", "half-wave-matching", "quarter-wave-matching-antireflection-coatings", "recursive-impedance-transformation-multilayers"]
---

## ConceptNode: Finite Dielectric Slab as a Two-Interface System

Planning node for [[finite-dielectric-slab-two-interface-system|1.252 Finite Dielectric Slab as a Two-Interface System]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 433, Page 434, Section 12.3.2: Wave Impedance

A finite dielectric slab creates a two-interface reflection problem because waves reflect repeatedly between its front and back surfaces. In steady state, the many individual reflections combine into five net waves: an incident wave and a net reflected wave in region 1, forward and backward waves in region 2, and a net transmitted wave in region 3. Each net wave has a definite complex amplitude and phase obtained by superposing all co-propagating contributions. For a lossless slab of thickness $l$, the region-2 fields are written as counterpropagating phasors. The backward electric-field amplitude is tied to the forward amplitude by the second-interface coefficient $\Gamma_{23}=(\eta_3-\eta_2)/(\eta_3+\eta_2)$. Because the magnetic field reverses its electric-to-magnetic sign relationship for backward propagation, the total field ratio varies with position. This position-dependent ratio is the wave impedance $\eta_w(z)=E_{xs2}/H_{ys2}$. Evaluating it at the slab's front surface gives an input impedance that summarizes the slab and region 3 as seen from region 1. The original multiple-reflection problem can then be treated as a single impedance discontinuity.

### Key planning details

- The steady-state system contains five net waves across the three regions.
- The region-2 electric field is $E_{xs2}=E_{x20}^{+}e^{-j\beta_2 z}+E_{x20}^{-}e^{j\beta_2 z}$.
- For a lossless dielectric, $\beta_2=\omega\sqrt{\epsilon_{r2}}/c$.
- The back-interface coefficient is $\Gamma_{23}=(\eta_3-\eta_2)/(\eta_3+\eta_2)$.
- The amplitudes satisfy $E_{x20}^{-}=\Gamma_{23}E_{x20}^{+}$.
- Backward propagation introduces $H_{y20}^{-}=-E_{x20}^{-}/\eta_2$.
- The wave impedance is a position-dependent ratio of total electric and magnetic fields.

### Source coverage

- Figure S1.P433.F1, corresponding to Figure 12.4, depicts the basic two-interface system and the input impedance $\eta_{\mathrm{in}}$ at the front surface.
- Page 433 identifies incident and reflected waves in region 1, counterpropagating waves in region 2, and a transmitted wave in region 3.
- Equation (28a) gives $E_{xs2}=E_{x20}^{+}e^{-j\beta_2z}+E_{x20}^{-}e^{j\beta_2z}$.
- Equation (28b) gives $H_{ys2}=H_{y20}^{+}e^{-j\beta_2z}+H_{y20}^{-}e^{j\beta_2z}$.
- Equations (30), (31a), and (31b) relate the forward and backward field amplitudes through $\Gamma_{23}$ and $\eta_2$.
- Equation (32) gives $$\eta_w(z)=\eta_2\frac{\eta_3\cos(\beta_2z)-j\eta_2\sin(\beta_2z)}{\eta_2\cos(\beta_2z)-j\eta_3\sin(\beta_2z)}.$$
