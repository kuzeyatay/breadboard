---
title: "Linear Polarization and Orthogonal Field Decomposition"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "linear-polarization-and-orthogonal-field-decomposition"
locations: ["Page 408", "Page 409", "Page 409, Figure 11.4", "Page 410"]
related: ["lossless-dielectric-plane-wave-propagation", "time-average-power-density-of-sinusoidal-waves", "elliptical-polarization-from-phase-displaced-components", "circular-polarization-and-handedness"]
---

## ConceptNode: Linear Polarization and Orthogonal Field Decomposition

Planning node for [[linear-polarization-and-orthogonal-field-decomposition|1.234 Linear Polarization and Orthogonal Field Decomposition]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 408, Page 409, Page 409, Figure 11.4, Page 410

Wave polarization is defined as the time-dependent orientation of the electric-field vector at a fixed point in space. For a uniform plane wave, $\mathbf{E}$, $\mathbf{H}$, and the propagation direction remain mutually orthogonal, but the transverse field orientation may depend on time, position, generation mechanism, or medium. A linearly polarized wave has an electric field confined to a fixed straight direction. For positive $z$ propagation, a general linearly polarized field can be written as $\mathbf{E}_s=(E_{x0}\mathbf{a}_x+E_{y0}\mathbf{a}_y)e^{-\alpha z}e^{-j\beta z}$. Its magnetic field is $\mathbf{H}_s=[-(E_{y0}/\eta)\mathbf{a}_x+(E_{x0}/\eta)\mathbf{a}_y]e^{-\alpha z}e^{-j\beta z}$. The minus sign ensures that each electric and magnetic component pair produces positive $z$ power flow. Figure 11.4 depicts this geometry. The average power density depends on $|E_{x0}|^2+|E_{y0}|^2$ and $\operatorname{Re}(1/\eta^*)$. This shows that a linearly polarized wave can be treated as two mutually perpendicular, in-phase plane waves. More generally, any polarization state can be constructed from perpendicular electric-field components and their relative phase.

### Key planning details

- Polarization describes electric-field orientation at a fixed spatial point.
- A linearly polarized field maintains a fixed transverse direction.
- A general transverse electric field has both $x$ and $y$ components.
- The corresponding magnetic components are $H_x=-E_y/\eta$ and $H_y=E_x/\eta$.
- The signs ensure that $\mathbf{E}\times\mathbf{H}$ points along positive $z$.
- Average power depends on the sum $|E_{x0}|^2+|E_{y0}|^2$.
- Any polarization state can be represented using perpendicular components and their relative phase.

### Source coverage

- Page 409 defines wave polarization as the time-dependent electric-field orientation at a fixed point.
- Equation (91) gives the general linearly polarized electric-field phasor.
- Equation (92) gives the associated magnetic-field phasor.
- Figure 11.4 shows the electric and magnetic configuration for positive $z$ propagation.
- Page 410 derives average power proportional to $(|E_{x0}|^2+|E_{y0}|^2)e^{-2\alpha z}$.
- The source identifies perpendicular components and their relative phasing as the basis for describing every polarization state.
