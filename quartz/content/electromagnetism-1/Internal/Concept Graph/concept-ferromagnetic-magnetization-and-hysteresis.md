---
title: "Ferromagnetic Magnetization and Hysteresis"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "ferromagnetic-magnetization-and-hysteresis"
locations: ["Page 272", "Page 273", "Section 8.8", "Figure 8.11", "Figure 8.12"]
related: ["classification-of-magnetic-materials", "anisotropic-and-nonlinear-magnetic-media", "nonlinear-gapped-magnetic-circuit-analysis"]
---

## ConceptNode: Ferromagnetic Magnetization and Hysteresis

Planning node for [[ferromagnetic-magnetization-and-hysteresis|1.126 Ferromagnetic Magnetization and Hysteresis]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 272, Page 273, Section 8.8, Figure 8.11, Figure 8.12

Ferromagnetic materials do not generally follow a single linear relationship between $B$ and $H$. Starting from a fully demagnetized state, the virgin magnetization curve initially rises from the origin, then changes slope, and eventually approaches saturation. For the silicon sheet steel shown in Figure 8.11, the rise becomes slower after $H$ reaches roughly 100 A-turn/m, and saturation begins when $H$ reaches several hundred A-turn/m. If $H$ is reduced after partial saturation, the material does not retrace the original curve. When $H$ reaches zero, a remnant flux density $B_r$ remains. A reversed field of magnitude $H_c$, called the coercive force, is required to bring $B$ back to zero. Repeated cycling produces the closed hysteresis loop shown in Figure 8.12. Smaller maximum excursions of $H$ produce smaller internal loops, whose tips lie approximately along the virgin magnetization curve. These behaviors explain why ferromagnetic magnetic circuits often require graph-based, iterative, or piecewise-linear calculations instead of a constant permeability.

### Key planning details

- The virgin magnetization curve begins from the demagnetized state $B=H=0$.
- Ferromagnetic $B$ does not rise linearly with $H$.
- Saturation occurs when further increases in $H$ produce relatively small increases in $B$.
- Reducing $H$ does not retrace the virgin curve.
- The remnant flux density $B_r$ remains when $H$ returns to zero.
- The coercive force $H_c$ is the reversed field required to reduce $B$ to zero.
- Repeated field cycling produces a hysteresis loop.
- Smaller field cycles produce smaller loops within the major loop.

### Source coverage

- Figure S13.P272.F8.11 is the magnetization curve of a silicon sheet-steel sample.
- The source reports a change in behavior near $H=100$ A-turn/m and saturation beginning at several hundred A-turn/m.
- Figure S13.P273.F8.12 labels remnant flux density $B_r$ and coercive force $H_c$ on the silicon-steel hysteresis loop.
- The locus of the tips of smaller hysteresis loops is described as approximately following the virgin magnetization curve.
- The nonlinear curve is used directly in Example 8.7 to determine the steel field intensity required for a specified flux density.
