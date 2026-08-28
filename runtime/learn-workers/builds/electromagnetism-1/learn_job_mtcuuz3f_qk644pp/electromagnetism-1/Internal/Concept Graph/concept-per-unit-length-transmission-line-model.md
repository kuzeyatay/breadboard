---
title: "Per-Unit-Length Transmission-Line Model"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "per-unit-length-transmission-line-model"
locations: ["Page 318", "Page 319", "Section 10.2: The Transmission Line Equations"]
related: ["distributed-versus-lumped-circuit-models", "transmission-line-field-and-circuit-models", "telegraphists-equations", "general-transmission-line-wave-equations"]
---

## ConceptNode: Per-Unit-Length Transmission-Line Model

Planning node for [[per-unit-length-transmission-line-model|1.163 Per-Unit-Length Transmission-Line Model]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 318, Page 319, Section 10.2: The Transmission Line Equations

A uniform line is represented over a short length $\Delta z$ by four primary constants per unit length: series resistance $R$, series inductance $L$, shunt conductance $G$, and shunt capacitance $C$. The short section therefore contains $R\Delta z$, $L\Delta z$, $G\Delta z$, and $C\Delta z$. Resistance models finite conductor conductivity, while conductance models leakage through an imperfect dielectric. Both dissipate power and can depend on frequency. Inductance and capacitance store magnetic and electric energy. The source divides the series elements equally between the two ends to create a symmetric section, although an equivalent split could be applied to the shunt elements. Voltage and current changes across this section become spatial derivatives in the limit $\Delta z\to0$, allowing ordinary KVL and KCL to generate continuous line equations.

### Key planning details

- $R$, $L$, $G$, and $C$ are specified per unit length.
- $R$ models conductor loss and $G$ models dielectric leakage.
- $L$ and $C$ represent distributed magnetic and electric energy storage.
- A section of length $\Delta z$ contains each parameter multiplied by $\Delta z$.
- The infinitesimal-section limit converts circuit differences into spatial derivatives.

### Source coverage

- Page 318 names $R$, $L$, $G$, and $C$ as the line's primary constants.
- Page 318 relates $G$ to dielectric conductivity and $R$ to conductor conductivity.
- Figure 10.3 on Page 319 shows the symmetric lossy line section of length $\Delta z$.
- Page 318 states that propagation is assumed in the $\mathbf{a}_z$ direction.
