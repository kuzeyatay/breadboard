---
title: "Integral Biot-Savart Law and Closed Steady Currents"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "integral-biot-savart-law-closed-steady-currents"
locations: ["Page 196", "Section 7.1.2: Integral Form of the Biot-Savart Law"]
related: ["differential-biot-savart-law", "current-source-representations", "ampere-circuital-law-enclosed-current"]
---

## ConceptNode: Integral Biot-Savart Law and Closed Steady Currents

Planning node for [[integral-biot-savart-law-closed-steady-currents|1.103 Integral Biot-Savart Law and Closed Steady Currents]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 196, Section 7.1.2: Integral Form of the Biot-Savart Law

An isolated differential dc current element cannot be produced experimentally, because steady current must satisfy charge conservation. For a direct current, the volume charge density does not vary with time, so the continuity equation becomes

$$\nabla\cdot\mathbf{J}=-\frac{\partial\rho_v}{\partial t}=0.$$

Applying the divergence theorem gives $\oint_S\mathbf{J}\cdot d\mathbf{S}=0$, meaning that the algebraic current crossing any closed surface is zero. A steady experimental current must therefore flow around a closed circuit rather than terminate at an isolated element. The experimentally testable Biot-Savart expression is consequently the closed-path integral

$$\mathbf{H}=\oint\frac{I\,d\mathbf{L}\times\mathbf{a}_R}{4\pi R^2}.$$

The text also notes a mathematical nonuniqueness in the differential expression: adding a conservative term $\nabla G$ does not change the closed integral because its circulation is zero. Thus predictions involving isolated differential current elements are not independently testable, whereas the integrated field of a closed current is physically meaningful.

### Key planning details

- Steady current satisfies $\nabla\cdot\mathbf{J}=0$.
- The net current through any closed surface is zero.
- An experimentally realizable steady current follows a closed path.
- Only the integral Biot-Savart law can be directly checked experimentally.
- A conservative term may be added to the differential law without changing its closed-path integral.
- Questions about isolated differential current elements can lack experimentally unique answers.

### Source coverage

- Page 196 gives the continuity equation $\nabla\cdot\mathbf{J}=-\partial\rho_v/\partial t$.
- Page 196 sets $\nabla\cdot\mathbf{J}=0$ for direct-current conditions.
- Page 196 applies the divergence theorem to obtain $\oint_S\mathbf{J}\cdot d\mathbf{S}=0$.
- Page 196 states that the experimental source must be current flowing in a closed circuit.
- Page 196 gives the integral form $\mathbf{H}=\oint I\,d\mathbf{L}\times\mathbf{a}_R/(4\pi R^2)$.
- Page 196 explains that adding $\nabla G$ does not alter the closed-path result.
