---
title: "Rectangular Waveguide Geometry and Absence of TEM"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "rectangular-waveguide-geometry-and-absence-of-tem"
locations: ["Page 479, Figure 13.7", "Page 494, Section 13.5", "Page 495, rectangular-guide TEM discussion"]
related: ["tem-transmission-line-waves-and-waveguide-modes", "rectangular-waveguide-transverse-field-reconstruction", "rectangular-waveguide-cutoff-condition"]
---

## ConceptNode: Rectangular Waveguide Geometry and Absence of TEM

Planning node for [[rectangular-waveguide-geometry-and-absence-of-tem|1.280 Rectangular Waveguide Geometry and Absence of TEM]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 479, Figure 13.7, Page 494, Section 13.5, Page 495, rectangular-guide TEM discussion

A rectangular waveguide is a hollow conducting structure used primarily at microwave frequencies. Its propagation direction is $z$, its width is $a$ along $x$, and its height is $b$ along $y$. It can be viewed geometrically as two orthogonal parallel-plate guides joined into one continuous conducting enclosure. Unlike the parallel-plate guide, the rectangular guide generally has field variation in both transverse coordinates, so the full three-dimensional wave equation must be used. It supports TE and TM modes but not TEM. The reason is the closed conducting boundary: the tangential electric field must vanish everywhere on all four walls. A completely transverse electric field cannot satisfy these conditions without varying sideways across the transverse plane. Once transverse variation is present, $\nabla\times\mathbf{E}=-j\omega\mu\mathbf{H}$ generates a longitudinal magnetic component, preventing the magnetic field from remaining entirely transverse. No alternative orientation produces both completely transverse electric and magnetic fields in the closed single-conductor guide.

### Key planning details

- The guide dimensions are width $a$ along $x$ and height $b$ along $y$.
- Propagation is along the $z$ axis.
- The boundary is a continuous closed conductor.
- Fields can vary in $x$, $y$, and $z$.
- The guide supports TE and TM mode families.
- The guide cannot support a TEM mode.
- The absence of TEM follows from tangential electric-field boundary conditions and Maxwell's curl equation.

### Source coverage

- Figure 13.7 shows the rectangular waveguide geometry.
- Page 494 introduces the guide as a microwave structure with dimensions $a$ and $b$.
- Page 495 describes it as two orthogonally oriented parallel-plate guides forming one continuous boundary.
- The source states that the full three-dimensional wave equation is required.
- The source explains that unavoidable transverse electric-field variation produces a longitudinal magnetic-field component.
