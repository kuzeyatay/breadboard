---
title: "Maxwell Equations and Supporting Constitutive Relations"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "maxwell-equations-and-supporting-constitutive-relations"
locations: ["Page 302", "Page 303", "Page 304"]
related: ["transformer-emf-and-the-differential-form-of-faradays-law", "displacement-current-from-charge-continuity", "maxwell-equations-in-integral-form-and-field-boundaries", "magnetic-force-and-torque-on-charges-and-currents", "magnetization-magnetic-materials-and-bound-currents", "permanent-magnetization-and-equivalent-magnetic-sources"]
---

## ConceptNode: Maxwell Equations and Supporting Constitutive Relations

Planning node for [[maxwell-equations-and-supporting-constitutive-relations|1.147 Maxwell Equations and Supporting Constitutive Relations]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 302, Page 303, Page 304

The source assembles the four point-form Maxwell equations for time-varying fields. Faraday's law is $$\nabla\times\mathbf{E}=-\frac{\partial\mathbf{B}}{\partial t},$$ and the Ampère-Maxwell law is $$\nabla\times\mathbf{H}=\mathbf{J}+\frac{\partial\mathbf{D}}{\partial t}.$$ Gauss's electric law remains $$\nabla\cdot\mathbf{D}=\rho_v,$$ while Gauss's magnetic law is $$\nabla\cdot\mathbf{B}=0.$$ Together they relate electric and magnetic fields to charge and current sources. The source stresses that changing magnetic fields can make electric flux lines circulate in closed loops, so not all electric flux lines need begin and end on charge. Magnetic flux, by contrast, always forms closed loops because no magnetic charge has been observed. Maxwell's equations require supporting relations to close a material problem, including $\mathbf{D}=\epsilon\mathbf{E}$, $\mathbf{B}=\mu\mathbf{H}$, $\mathbf{J}=\sigma\mathbf{E}$, and $\mathbf{J}=\rho_v\mathbf{v}$. More general material descriptions use polarization $\mathbf{P}$ and magnetization $\mathbf{M}$. The force connection is supplied by the Lorentz force density $\mathbf{f}=\rho_v(\mathbf{E}+\mathbf{v}\times\mathbf{B})$.

### Key planning details

- Faraday's point equation couples changing $\mathbf{B}$ to curl of $\mathbf{E}$.
- The Ampère-Maxwell equation couples current and changing $\mathbf{D}$ to curl of $\mathbf{H}$.
- Electric charge density is the divergence source of $\mathbf{D}$.
- Magnetic flux density has zero divergence.
- Constitutive relations are needed to connect intensity and flux-density fields.
- Polarization and magnetization provide more general material descriptions.
- The Lorentz force density links fields to mechanical force on charge.

### Source coverage

- Equations (20) through (23) list the four point-form Maxwell equations.
- The source states that changing magnetic fields allow electric flux lines to form closed loops.
- Equation (23), $\nabla\cdot\mathbf{B}=0$, is interpreted as the absence of known magnetic charges.
- Equations (24) through (27) give $\mathbf{D}=\epsilon\mathbf{E}$, $\mathbf{B}=\mu\mathbf{H}$, conduction current, and convection current.
- Equations (28) and (29) give $\mathbf{D}=\epsilon_0\mathbf{E}+\mathbf{P}$ and $\mathbf{B}=\mu_0(\mathbf{H}+\mathbf{M})$.
- Equations (30) and (31) relate polarization and magnetization to field intensity in linear materials.
- Equation (32) gives $\mathbf{f}=\rho_v(\mathbf{E}+\mathbf{v}\times\mathbf{B})$.
