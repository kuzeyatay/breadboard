---
title: "Rectangular Waveguide Transverse Field Reconstruction"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "rectangular-waveguide-transverse-field-reconstruction"
locations: ["Page 495, Section 13.5.1 and Equations (76) through (78)", "Page 496, Equations (79) through (81)"]
related: ["rectangular-waveguide-geometry-and-absence-of-tem", "rectangular-waveguide-tm-eigenmodes", "rectangular-waveguide-te-eigenmodes", "rectangular-waveguide-cutoff-condition"]
---

## ConceptNode: Rectangular Waveguide Transverse Field Reconstruction

Planning node for [[rectangular-waveguide-transverse-field-reconstruction|1.281 Rectangular Waveguide Transverse Field Reconstruction]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 495, Section 13.5.1 and Equations (76) through (78), Page 496, Equations (79) through (81)

The standard rectangular-waveguide method solves first for a longitudinal field component and then reconstructs all transverse components using Maxwell's equations. For TE modes, $E_z=0$, so the wave equation is solved for $H_z$. For TM modes, $H_z=0$, so it is solved for $E_z$. Forward propagation is assumed through factors $e^{-j\beta z}$, making $\partial/\partial z=-j\beta$. Combining the transverse components of the two curl equations expresses $E_x$, $E_y$, $H_x$, and $H_y$ in terms of derivatives of $E_z$ and $H_z$. The common transverse constant is $$\kappa=\sqrt{k^2-\beta^2}.$$ Because rectangular modes vary along both $x$ and $y$, two indices are required and $$\kappa_{mp}=\sqrt{k^2-\beta_{mp}^2}.$$ The indices $m$ and $p$ describe transverse field variations in the $x$ and $y$ directions. Geometrically, $\kappa_{mp}$ is the transverse-plane component of the full wavevector, while $\beta_{mp}$ is its axial component.

### Key planning details

- Solve for $H_z$ in a TE mode because $E_z=0$.
- Solve for $E_z$ in a TM mode because $H_z=0$.
- Forward propagation gives the common factor $e^{-j\beta z}$.
- The derivative rule is $\partial/\partial z=-j\beta$.
- Maxwell's curl equations recover all four transverse field components.
- The transverse constant satisfies $\kappa^2=k^2-\beta^2$.
- Rectangular modes require two indices, $m$ and $p$.
- $\kappa_{mp}$ and $\beta_{mp}$ are transverse and axial wavevector components.

### Source coverage

- Equations (76a) and (76b) define forward-$z$ electric and magnetic phasors.
- Equations (77) and (78) give the transverse components of Maxwell's curl equations.
- Equations (79a) through (79d) express transverse fields through derivatives of $E_z$ and $H_z$.
- Equation (80) defines $\kappa=\sqrt{k^2-\beta^2}$.
- Equation (81) introduces the two-index constants $\kappa_{mp}$ and $\beta_{mp}$.
- The source interprets $m$ and $p$ as field variations along $x$ and $y$.
