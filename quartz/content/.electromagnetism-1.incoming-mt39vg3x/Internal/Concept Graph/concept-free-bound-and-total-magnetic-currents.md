---
title: "Free, Bound, and Total Magnetic Currents"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "free-bound-and-total-magnetic-currents"
locations: ["Page 263", "Page 264", "Page 266", "Section 8.6", "Problem D8.7"]
related: ["magnetization-and-bound-currents", "linear-magnetic-constitutive-relations", "magnetic-boundary-conditions"]
---

## ConceptNode: Free, Bound, and Total Magnetic Currents

Planning node for [[free-bound-and-total-magnetic-currents|1.120 Free, Bound, and Total Magnetic Currents]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 263, Page 264, Page 266, Section 8.6, Problem D8.7

The magnetic flux density $\mathbf{B}$ responds to both free current and the microscopic bound currents represented by magnetization. Ampère's law written with $\mathbf{B}$ includes the total enclosed current, $I_T=I_B+I$, where $I_B$ is bound current and $I$ is free current. Thus $\oint(\mathbf{B}/\mu_0)\cdot d\mathbf{L}=I_T$. Subtracting the magnetization circulation $I_B=\oint\mathbf{M}\cdot d\mathbf{L}$ isolates the free current as $I=\oint(\mathbf{B}/\mu_0-\mathbf{M})\cdot d\mathbf{L}$. This motivates the definition $\mathbf{H}=\mathbf{B}/\mu_0-\mathbf{M}$, after which Ampère's circuital law becomes $I=\oint\mathbf{H}\cdot d\mathbf{L}$. In local form, the three current categories satisfy $\nabla\times(\mathbf{B}/\mu_0)=\mathbf{J}_T$, $\nabla\times\mathbf{M}=\mathbf{J}_B$, and $\nabla\times\mathbf{H}=\mathbf{J}$. The text emphasizes the last equation because Maxwell's equations use free current density without a subscript. This separation allows material magnetization to be absorbed into constitutive properties while externally supplied conduction currents remain explicit sources.

### Key planning details

- Total current is the sum $I_T=I_B+I$.
- The $\mathbf{B}$ circulation counts total current: $\oint(\mathbf{B}/\mu_0)\cdot d\mathbf{L}=I_T$.
- The $\mathbf{M}$ circulation counts bound current: $\oint\mathbf{M}\cdot d\mathbf{L}=I_B$.
- The field $\mathbf{H}$ is defined to isolate free current.
- Ampère's law in matter is $\oint\mathbf{H}\cdot d\mathbf{L}=I$.
- The differential free-current law is $\nabla\times\mathbf{H}=\mathbf{J}$.
- Bound, free, and total currents also have surface-integral representations through their respective current densities.

### Source coverage

- Equation (22) states $\oint(\mathbf{B}/\mu_0)\cdot d\mathbf{L}=I_T$.
- Equation (23) isolates free current as $I=\oint(\mathbf{B}/\mu_0-\mathbf{M})\cdot d\mathbf{L}$.
- Equation (24) defines $\mathbf{H}=\mathbf{B}/\mu_0-\mathbf{M}$.
- Equation (26) gives $I=\oint\mathbf{H}\cdot d\mathbf{L}$.
- Equation (27) gives $\nabla\times\mathbf{H}=\mathbf{J}$.
- Problem D8.7 uses a specified magnetization field to distinguish $\mathbf{J}_T$, $\mathbf{J}$, and $\mathbf{J}_B$.
