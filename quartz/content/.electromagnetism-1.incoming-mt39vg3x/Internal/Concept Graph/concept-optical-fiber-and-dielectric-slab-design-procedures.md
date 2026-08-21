---
title: "Optical Fiber and Dielectric Slab Design Procedures"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "optical-fiber-and-dielectric-slab-design-procedures"
locations: ["Page 525", "Page 526", "Figure 13.26", "Problems 13.26-13.32"]
related: ["mode-confinement-and-mode-field-radius-in-step-index-fiber", "guided-mode-cutoff-and-single-mode-operation"]
---

## ConceptNode: Optical Fiber and Dielectric Slab Design Procedures

Planning node for [[optical-fiber-and-dielectric-slab-design-procedures|1.305 Optical Fiber and Dielectric Slab Design Procedures]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 525, Page 526, Figure 13.26, Problems 13.26-13.32

The dielectric-guide problems extend cutoff and modal analysis to symmetric and asymmetric slabs and to step-index optical fibers. In a symmetric slab, thickness, core index $n_1$, cladding index $n_2$, and free-space wavelength determine which TE and TM modes can propagate. Inverse problems use a single-mode requirement to bound the allowable core index or another design parameter. At modal cutoff, the phase velocity can be interpreted through the limiting propagation constant, and the same reasoning can be tested for higher-order modes. The asymmetric slab in Figure 13.26 has unequal exterior indices ordered as $n_1>n_3>n_2$. Its weakest total-internal-reflection boundary sets the minimum guided wave angle and therefore the maximum possible phase velocity. The fiber problems use the scaling of normalized frequency with core radius and wavelength to redesign the single-mode cutoff while retaining the same materials. They also reinforce that a single-mode field extends beyond the physical core, so the mode field radius is greater than the core radius. A measured mode radius and cutoff wavelength can be combined with wavelength-dependent normalized parameters to predict the radius at another wavelength.

### Key planning details

- Slab mode content is determined by thickness, refractive-index contrast, and wavelength.
- A single-mode requirement can place an upper bound on the slab core index.
- Modal phase velocity at cutoff follows from the cutoff value of the propagation constant.
- In an asymmetric slab, the lower-confinement interface limits the guided wave angle.
- The maximum guided-mode phase velocity follows from the minimum allowed wave angle.
- For fixed fiber materials, single-mode cutoff wavelength scales with core radius.
- The mode field radius of a single-mode step-index fiber exceeds the physical core radius.
- Mode field radius measurements at one wavelength can support prediction at another wavelength.

### Source coverage

- Problem 13.26 specifies a symmetric slab with $d=10\,\mu\mathrm{m}$, $n_1=1.48$, $n_2=1.45$, and $\lambda=1.3\,\mu\mathrm{m}$.
- Problem 13.27 asks for the maximum $n_1$ compatible with one TE/TM mode pair at $\lambda=1.55\,\mu\mathrm{m}$ when $d=5\,\mu\mathrm{m}$ and $n_2=3.30$.
- Figure 13.26 and Problem 13.29 define an asymmetric slab with $n_1>n_3>n_2$.
- Problem 13.30 compares fibers made from the same materials with single-mode thresholds of $1.2\,\mu\mathrm{m}$ and $0.63\,\mu\mathrm{m}$.
- Problem 13.32 gives a measured mode field radius of $4.5\,\mu\mathrm{m}$ at $1.30\,\mu\mathrm{m}$ and cutoff wavelength $1.20\,\mu\mathrm{m}$.
