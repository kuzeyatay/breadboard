---
title: "Conductivity as Imaginary Permittivity"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "conductivity-as-imaginary-permittivity"
locations: ["Page 394", "Page 395", "Page 396, Figure 11.2"]
related: ["microwave-absorption-and-penetration-in-water", "good-dielectric-approximation", "good-conductor-propagation-approximation", "poynting-vector-and-electromagnetic-energy-conservation"]
---

## ConceptNode: Conductivity as Imaginary Permittivity

Planning node for [[conductivity-as-imaginary-permittivity|1.225 Conductivity as Imaginary Permittivity]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 394, Page 395, Page 396, Figure 11.2

In a conducting medium, free charge carriers move under an electric field and produce conduction current according to $\mathbf{J}=\sigma\mathbf{E}$. The Maxwell curl equation can represent loss either through a complex permittivity $\epsilon'-j\epsilon''$ or by explicitly separating conduction and displacement currents. Writing $\nabla\times\mathbf{H}_s=(\sigma+j\omega\epsilon')\mathbf{E}_s$ and comparing it with $\nabla\times\mathbf{H}_s=j\omega(\epsilon'-j\epsilon'')\mathbf{E}_s$ gives $\epsilon''=\sigma/\omega$. The loss tangent is therefore $\epsilon''/\epsilon'=\sigma/(\omega\epsilon')$. It also equals the magnitude ratio of conduction current density to displacement current density. These currents point in the same spatial direction but differ in time phase by $90^\circ$, with displacement current leading conduction current. Figure 11.2 organizes the phasor relationship among $\mathbf{J}_{ds}$, $\mathbf{J}_{\sigma s}$, total current $\mathbf{J}_s$, and $\mathbf{E}_s$. The angle $\theta$ satisfies $\tan\theta=\sigma/(\omega\epsilon')$, explaining the name loss tangent. The reciprocal of this quantity is identified as the quality factor $Q$ of a capacitor containing the lossy dielectric.

### Key planning details

- Conduction current obeys $\mathbf{J}_{\sigma s}=\sigma\mathbf{E}_s$.
- Displacement current is $\mathbf{J}_{ds}=j\omega\epsilon'\mathbf{E}_s$.
- Conductivity contributes an imaginary permittivity $\epsilon''=\sigma/\omega$.
- The loss tangent is $\tan\theta=\epsilon''/\epsilon'=\sigma/(\omega\epsilon')$.
- The loss tangent measures the conduction-current to displacement-current magnitude ratio.
- Displacement current leads conduction current by $90^\circ$.
- The capacitor quality factor for a lossy dielectric is the reciprocal of the loss tangent.

### Source coverage

- Equations (53) through (55) present equivalent complex-permittivity and explicit-current forms of the Maxwell curl equation.
- Equation (56) gives $\epsilon''=\sigma/\omega$.
- Equation (57) gives $\mathbf{J}_{\sigma s}/\mathbf{J}_{ds}=\sigma/(j\omega\epsilon')$.
- Equation (58) gives $\tan\theta=\epsilon''/\epsilon'=\sigma/(\omega\epsilon')$.
- Figure 11.2 shows the time-phase relationship among displacement, conduction, total current, and electric field.
- The caption of Figure 11.2 identifies $90^\circ-\theta$ as the power-factor angle by which total current leads the electric field.
