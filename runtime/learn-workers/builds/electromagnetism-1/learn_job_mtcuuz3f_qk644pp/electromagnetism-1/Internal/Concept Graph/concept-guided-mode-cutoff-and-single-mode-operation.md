---
title: "Guided-Mode Cutoff and Single-Mode Operation"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "guided-mode-cutoff-and-single-mode-operation"
locations: ["Page 523", "Page 524", "Figure 13.25", "Problems 13.11-13.21"]
related: ["transmission-line-parameter-and-impedance-design-procedures", "waveguide-power-flow-and-field-structure", "waveguide-dispersion-and-pulse-broadening", "optical-fiber-and-dielectric-slab-design-procedures"]
---

## ConceptNode: Guided-Mode Cutoff and Single-Mode Operation

Planning node for [[guided-mode-cutoff-and-single-mode-operation|1.302 Guided-Mode Cutoff and Single-Mode Operation]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 523, Page 524, Figure 13.25, Problems 13.11-13.21

Cutoff separates propagating modes from evanescent modes in parallel-plate and rectangular waveguides. The problem set develops a consistent method: determine each mode's cutoff frequency or cutoff wavelength from guide dimensions and material properties, compare the operating frequency with those thresholds, and count or identify the modes that satisfy the propagation condition. For a parallel-plate guide intended to carry only TEM over a stated band, the plate spacing must be small enough that the first TE and TM cutoff remains above the maximum operating frequency. Conversely, a known cutoff can be used to infer plate separation or dielectric constant. Rectangular-guide design requires ordering the cutoff frequencies of $\mathrm{TE}_{mn}$ and $\mathrm{TM}_{mn}$ modes, then placing the operating band above the dominant-mode cutoff and below the next available cutoff. Problems involving joined air-filled and dielectric-filled guides add a simultaneous constraint: the same frequency must lie in the single-mode interval of both regions. The dielectric interfaces in a partially filled parallel-plate guide also connect modal propagation to oblique-wave ideas, including Brewster transmission and total internal reflection at the critical angle.

### Key planning details

- A mode propagates only when the operating frequency exceeds its cutoff frequency.
- TEM operation alone requires suppressing the first higher-order TE and TM modes.
- Mode counting follows from comparing the operating frequency with all relevant modal cutoffs.
- Guide dimensions and dielectric constant can be inferred from measured cutoff information.
- Rectangular-waveguide single-mode operation lies between the dominant-mode cutoff and the next-lowest cutoff.
- Joined guides require an overlap between the single-mode frequency intervals of both regions.
- Brewster-angle matching can eliminate reflection for a TM mode at a dielectric interface.
- Critical-angle behavior can cause total modal reflection at a dielectric interface.

### Source coverage

- Problems 13.11 through 13.16 address mode counting, TEM-only design, dielectric inference, propagating-mode identification, group delay, and group velocity in parallel-plate guides.
- Figure 13.25 supports Problems 13.17 and 13.18, which use a guide partially filled with dielectrics having $\epsilon'_{r1}=4.0$ and $\epsilon'_{r2}=2.1$.
- Problem 13.17 explicitly invokes Brewster's angle for reflectionless $\mathrm{TM}_1$ transmission.
- Problem 13.18 invokes the critical angle to determine a total-reflection frequency range.
- Problems 13.19 through 13.21 require rectangular-waveguide single-mode bands and dimensional design.
