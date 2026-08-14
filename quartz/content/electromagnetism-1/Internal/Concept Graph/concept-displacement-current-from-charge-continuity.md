---
title: "Displacement Current from Charge Continuity"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "displacement-current-from-charge-continuity"
locations: ["Page 298", "Page 299"]
related: ["capacitor-illustration-of-displacement-current", "maxwell-equations-and-supporting-constitutive-relations", "transition-from-static-fields-to-time-varying-electromagnetics"]
---

## ConceptNode: Displacement Current from Charge Continuity

Planning node for [[displacement-current-from-charge-continuity|1.145 Displacement Current from Charge Continuity]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 298, Page 299

Maxwell's modification of Ampère's law is motivated by a consistency problem. The steady-field equation $\nabla\times\mathbf{H}=\mathbf{J}$ implies, after taking divergence, that $\nabla\cdot\mathbf{J}=0$ because the divergence of a curl is identically zero. The continuity equation instead requires $$\nabla\cdot\mathbf{J}=-\frac{\partial\rho_v}{\partial t},$$ so the unmodified law would permit only time-independent charge density. Maxwell adds a term $\mathbf{G}$ and requires its divergence to equal $\partial\rho_v/\partial t$. Using Gauss's law, $\rho_v=\nabla\cdot\mathbf{D}$, the simplest consistent choice is $$\mathbf{G}=\frac{\partial\mathbf{D}}{\partial t}.$$ The corrected point equation is therefore $$\nabla\times\mathbf{H}=\mathbf{J}+\frac{\partial\mathbf{D}}{\partial t}.$$ The added quantity has units of amperes per square meter and is called displacement current density, $\mathbf{J}_d=\partial\mathbf{D}/\partial t$. It differs physically from conduction current $\mathbf{J}=\sigma\mathbf{E}$ and convection current $\mathbf{J}=\rho_v\mathbf{v}$, but all contribute to the magnetic-field circulation required by the corrected law.

### Key planning details

- The divergence of $\nabla\times\mathbf{H}$ is identically zero.
- Charge continuity requires $\nabla\cdot\mathbf{J}=-\partial\rho_v/\partial t$.
- The steady Ampère law is inadequate when charge density changes with time.
- Gauss's law provides $\rho_v=\nabla\cdot\mathbf{D}$.
- The correction term is $\partial\mathbf{D}/\partial t$.
- Displacement current density is $\mathbf{J}_d=\partial\mathbf{D}/\partial t$.
- The corrected law is $\nabla\times\mathbf{H}=\mathbf{J}+\mathbf{J}_d$.

### Source coverage

- Equation (16) gives the steady-field form $\nabla\times\mathbf{H}=\mathbf{J}$.
- The source takes divergence and compares the result with $\nabla\cdot\mathbf{J}=-\partial\rho_v/\partial t$.
- The unknown correction $\mathbf{G}$ is constrained by $\nabla\cdot\mathbf{G}=\partial\rho_v/\partial t$.
- Replacing $\rho_v$ by $\nabla\cdot\mathbf{D}$ leads to $\mathbf{G}=\partial\mathbf{D}/\partial t$.
- Equation (17) gives $\nabla\times\mathbf{H}=\mathbf{J}+\partial\mathbf{D}/\partial t$.
- The source identifies conduction current $\mathbf{J}=\sigma\mathbf{E}$ and convection current $\mathbf{J}=\rho_v\mathbf{v}$.
