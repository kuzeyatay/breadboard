---
title: "Mode Confinement and Mode Field Radius in Step-Index Fiber"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "mode-confinement-and-mode-field-radius-in-step-index-fiber"
locations: ["Page 520", "Page 521", "Figure 13.23", "Figure 13.24", "Problem D13.12"]
related: ["optical-fiber-and-dielectric-slab-design-procedures", "waveguide-dispersion-and-pulse-broadening", "guided-mode-cutoff-and-single-mode-operation"]
---

## ConceptNode: Mode Confinement and Mode Field Radius in Step-Index Fiber

Planning node for [[mode-confinement-and-mode-field-radius-in-step-index-fiber|1.300 Mode Confinement and Mode Field Radius in Step-Index Fiber]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 520, Page 521, Figure 13.23, Figure 13.24, Problem D13.12

The mode field radius characterizes the transverse extent of the guided optical field and is an important commercial single-mode fiber specification alongside cutoff wavelength. In a weakly guiding step-index fiber, the radial field follows a Bessel-function dependence in the core and a modified Bessel-function dependence in the cladding, with the two solutions connecting at the core radius $\rho=a$. The source compares the first two linearly polarized modes and shows that $\mathrm{LP}_{11}$ is less tightly confined than $\mathrm{LP}_{01}$ at the same operating frequency. It also shows that increasing normalized frequency $V$ draws the $\mathrm{LP}_{01}$ mode power toward the fiber axis. Mode field radius directly affects engineering performance. Matched mode radii and precise axial alignment minimize connection or splice loss, while radius mismatch and lateral displacement increase loss. Larger mode radii relax alignment tolerance, but smaller radii improve resistance to bend-induced radiation because tightly confined modes are less likely to escape when the fiber curves. Since the mode parameters $u$ and $w$ can be obtained from the normalized mode radius, the propagation constant $\beta$ can also be inferred. Measuring mode field radius as a function of frequency therefore provides information about $\beta(\omega)$ and optical dispersion.

### Key planning details

- Mode field radius and cutoff wavelength are major specifications of commercial single-mode fiber.
- Lowest splice or connector loss requires matched mode field radii and aligned fiber axes.
- Radius mismatch or transverse axis displacement increases connection loss.
- A larger mode field radius permits somewhat greater alignment error.
- A smaller mode field radius provides stronger confinement and lower bend loss.
- The radial core and cladding solutions connect at $\rho=a$.
- Increasing normalized frequency $V$ moves modal power toward the fiber axis.
- Frequency-dependent mode field radius can be used to infer $\beta(\omega)$ and dispersion.

### Source coverage

- Figure 13.23 compares $\mathrm{LP}_{01}$ and $\mathrm{LP}_{11}$ intensity versus normalized radius $\rho/a$ and shows weaker confinement of $\mathrm{LP}_{11}$.
- Figure 13.24 shows $\mathrm{LP}_{01}$ traces for $V=1.0$, $1.2$, and $1.5$, with power migrating toward the axis as frequency increases.
- The core dependence is labeled $J_0(u\rho/a)$ and the cladding dependence $K_0(w\rho/a)$.
- For the fiber of Example 13.6 with $a=5.0\,\mu\mathrm{m}$, the mode field radii are $6.78\,\mu\mathrm{m}$ at $1.55\,\mu\mathrm{m}$ and $5.82\,\mu\mathrm{m}$ at $1.30\,\mu\mathrm{m}$.
- The text states that $u$ and $w$, found from the normalized mode radius, permit calculation of the phase constant $\beta$.
