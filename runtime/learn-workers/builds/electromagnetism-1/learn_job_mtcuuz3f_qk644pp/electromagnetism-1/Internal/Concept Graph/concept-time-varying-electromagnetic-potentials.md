---
title: "Time-Varying Electromagnetic Potentials"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "time-varying-electromagnetic-potentials"
locations: ["Page 307", "Page 308", "Section 9.5: The Retarded Potentials"]
related: ["static-scalar-and-vector-potentials", "lorenz-gauge-and-potential-wave-equations", "potential-and-duality-problems"]
---

## ConceptNode: Time-Varying Electromagnetic Potentials

Planning node for [[time-varying-electromagnetic-potentials|1.153 Time-Varying Electromagnetic Potentials]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 307, Page 308, Section 9.5: The Retarded Potentials

The magnetic relation $\mathbf{B}=\nabla\times\mathbf{A}$ remains compatible with $\nabla\cdot\mathbf{B}=0$ because the divergence of any curl is identically zero. The static electric relation $\mathbf{E}=-\nabla V$ is not sufficient for time-varying fields because its curl is zero, contradicting Faraday's law when $\partial\mathbf{B}/\partial t\ne0$. Introducing an additional term $\mathbf{N}$ gives $\mathbf{E}=-\nabla V+\mathbf{N}$. Taking the curl and using Faraday's law together with $\mathbf{B}=\nabla\times\mathbf{A}$ yields $\nabla\times\mathbf{N}=-\nabla\times(\partial\mathbf{A}/\partial t)$. The simplest choice is $\mathbf{N}=-\partial\mathbf{A}/\partial t$, which produces $$\mathbf{E}=-\nabla V-\frac{\partial\mathbf{A}}{\partial t}.$$ The first term represents the scalar-potential contribution, while the second accounts for electric fields induced by changing magnetic potential.

### Key planning details

- $\mathbf{B}=\nabla\times\mathbf{A}$ automatically satisfies $\nabla\cdot\mathbf{B}=0$.
- $\mathbf{E}=-\nabla V$ alone incorrectly forces $\nabla\times\mathbf{E}=0$.
- Faraday's law requires an additional time-dependent vector-potential term.
- The time-varying electric field is $\mathbf{E}=-\nabla V-\partial\mathbf{A}/\partial t$.
- The derivation uses the identities for the curl of a gradient and the divergence of a curl.

### Source coverage

- Page 307 tests Equation (50) against $\nabla\cdot\mathbf{B}=0$.
- Page 307 introduces $\mathbf{E}=-\nabla V+\mathbf{N}$ after identifying the failure of the static relation.
- Equation (51) gives $\mathbf{E}=-\nabla V-\partial\mathbf{A}/\partial t$.
- Page 307 substitutes the potential definitions into Ampère's law and Gauss's law to continue the consistency check.
