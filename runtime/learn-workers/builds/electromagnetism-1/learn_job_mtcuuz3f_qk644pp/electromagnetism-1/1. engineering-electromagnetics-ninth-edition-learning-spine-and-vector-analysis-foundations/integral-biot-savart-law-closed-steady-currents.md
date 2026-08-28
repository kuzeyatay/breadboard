---
title: "1.103 Integral Biot-Savart Law and Closed Steady Currents"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 196", "Section 7.1.2: Integral Form of the Biot-Savart Law"]
related: ["differential-biot-savart-law", "current-source-representations", "ampere-circuital-law-enclosed-current"]
---

# 1.103 Integral Biot-Savart Law and Closed Steady Currents

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 196, Section 7.1.2: Integral Form of the Biot-Savart Law

An isolated differential dc current element cannot be produced experimentally, because steady current must satisfy charge conservation. For a direct current, the volume charge density does not vary with time, so the continuity equation becomes
$$
\nabla\cdot\mathbf{J}=-\frac{\partial\rho_v}{\partial t}=0
$$
Applying the divergence theorem gives $\oint_S\mathbf{J}\cdot d\mathbf{S}=0$, meaning that the algebraic current crossing any closed surface is zero. A steady experimental current must therefore flow around a closed circuit rather than terminate at an isolated element. The experimentally testable Biot-Savart expression is consequently the closed-path integral
$$
\mathbf{H}=\oint\frac{I\,d\mathbf{L}\times\mathbf{a}_R}{4\pi R^2}
$$
The text also notes a mathematical nonuniqueness in the differential expression: adding a conservative term $\nabla G$ does not change the closed integral because its circulation is zero. Thus predictions involving isolated differential current elements are not independently testable, whereas the integrated field of a closed current is physically meaningful.

## Page-Grounded Details

#### Page 196

The law of Biot-Savart is sometimes called Ampère's law for the current element, but we will retain the former name because of possible confusion with Ampère's circuital law, to be discussed later.

In some aspects, the Biot-Savart law is reminiscent of Coulomb's law when that law is written for a differential element of charge,
$$
dE_{2}=\frac{dQ_{1}a_{R12}}{4\pi\epsilon_{0}R_{12}^{2}}
$$
Both show an inverse-square-law dependence on distance, and both show a linear relationship between source and field. The chief difference appears in the direction of the field.

#### 7.1.2 Integral Form of the Biot-Savart Law

It is impossible to check experimentally the law of Biot-Savart as expressed by (1) or (2) because the differential current element cannot be isolated. We have restricted our attention to direct currents only, so the charge density is not a function of time. The continuity equation in Section 5.2, Eq. (5),
$$
\nabla\cdot J=-\frac{\partial\rho_{v}}{\partial t}
$$
therefore shows that
$$
\nabla\cdot J=0
$$
or upon applying the divergence theorem,
$$
\oint_{s}J\cdot dS=0
$$
The total current crossing any closed surface is zero, and this condition may be satisfied only

[Truncated for analysis]

## Core Ideas

- Steady current satisfies $\nabla\cdot\mathbf{J}=0$.
- The net current through any closed surface is zero.
- An experimentally realizable steady current follows a closed path.
- Only the integral Biot-Savart law can be directly checked experimentally.
- A conservative term may be added to the differential law without changing its closed-path integral.
- Questions about isolated differential current elements can lack experimentally unique answers.

## Source Anchors

- Page 196 gives the continuity equation $\nabla\cdot\mathbf{J}=-\partial\rho_v/\partial t$.
- Page 196 sets $\nabla\cdot\mathbf{J}=0$ for direct-current conditions.
- Page 196 applies the divergence theorem to obtain $\oint_S\mathbf{J}\cdot d\mathbf{S}=0$.
- Page 196 states that the experimental source must be current flowing in a closed circuit.
- Page 196 gives the integral form $\mathbf{H}=\oint I\,d\mathbf{L}\times\mathbf{a}_R/(4\pi R^2)$.
- Page 196 explains that adding $\nabla G$ does not alter the closed-path result.

## Related Pages

- [[differential-biot-savart-law|Differential Biot-Savart Law]]
- [[current-source-representations|Current Source Representations]]
- [[ampere-circuital-law-enclosed-current|Ampere's Circuital Law and Enclosed Current]]

## Concept Dependencies

- applies-to: [[current-source-representations|Current Source Representations]]
