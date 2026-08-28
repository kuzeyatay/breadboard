---
title: "Magnetic Material Interfaces and Spatially Varying Permeability"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "magnetic-material-interfaces-and-spatially-varying-permeability"
locations: ["Page 287"]
related: ["magnetization-magnetic-materials-and-bound-currents", "magnetic-circuits-reluctance-and-air-gaps", "maxwell-equations-in-integral-form-and-field-boundaries"]
---

## ConceptNode: Magnetic Material Interfaces and Spatially Varying Permeability

Planning node for [[magnetic-material-interfaces-and-spatially-varying-permeability|1.136 Magnetic Material Interfaces and Spatially Varying Permeability]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 287

Several problems develop field analysis in regions whose permeability changes with position or changes abruptly across an interface. The key planning procedure is to determine $\mathbf{H}$ from free current using Ampère's circuital law whenever symmetry permits, then obtain $\mathbf{B}$ from the local material relation $\mathbf{B}=\mu\mathbf{H}$. This distinction is especially clear in coaxial and filamentary geometries: the same enclosed free current can establish a common circulation pattern for $\mathbf{H}$, while $\mathbf{B}$ changes from region to region with permeability. For a planar interface between two magnetic media, the field is decomposed into normal and tangential components. In the absence of an appropriate surface current, tangential $\mathbf{H}$ is continuous, while normal $\mathbf{B}$ is continuous because $\nabla\cdot\mathbf{B}=0$. These conditions can change the field direction across the boundary. The source also includes continuously varying permeability, such as $\mu_r=az+1$, and composite cross sections inside a solenoid. In those cases, flux requires integration of the local $\mathbf{B}$ over the relevant area rather than multiplication by one uniform permeability.

### Key planning details

- Free current and symmetry are used first to determine $\mathbf{H}$.
- Local magnetic flux density follows from $\mathbf{B}=\mu\mathbf{H}$.
- Piecewise permeability can make $\mathbf{B}$ discontinuous even when the circulation of $\mathbf{H}$ has the same current source.
- Normal $\mathbf{B}$ is continuous across a magnetic-material interface.
- Tangential $\mathbf{H}$ is continuous when no free surface current is present.
- Continuously varying permeability requires local field evaluation and flux integration.
- Composite material regions can divide total flux unevenly.

### Source coverage

- Problem 8.23 specifies three radial permeability layers in a coaxial cable and asks for $H_\phi$, $B_\phi$, and $M_\phi$ at selected radii.
- Problem 8.24 places two current sheets around a material with $\mu_r=az+1$ and asks for $\mathbf{H}$, $\mathbf{B}$, and total flux.
- Problem 8.25 gives a current filament surrounded by regions with $\mu_r=1$, $6$, and $1$ and asks for $\mathbf{H}$ and $\mathbf{B}$ everywhere.
- Problem 8.26 divides a solenoid cross section into regions with $\mu_r=5$ and $\mu_r=1$ and asks for a boundary radius satisfying flux constraints.
- Problem 8.27 asks for normal and tangential components of $\mathbf{H}$ across an interface with $\mu_{r1}=2$ and $\mu_{r2}=5$.
