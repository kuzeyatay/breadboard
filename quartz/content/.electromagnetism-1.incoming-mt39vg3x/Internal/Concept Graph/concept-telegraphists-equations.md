---
title: "Telegraphist's Equations"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "telegraphists-equations"
locations: ["Page 319", "Page 320", "Section 10.2: The Transmission Line Equations"]
related: ["per-unit-length-transmission-line-model", "general-transmission-line-wave-equations", "lossless-traveling-wave-solutions", "characteristic-impedance-and-wave-current-direction"]
---

## ConceptNode: Telegraphist's Equations

Planning node for [[telegraphists-equations|1.164 Telegraphist's Equations]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 319, Page 320, Section 10.2: The Transmission Line Equations

Applying KVL to the symmetric incremental line section and retaining terms that survive as $\Delta z\to0$ gives the voltage equation $$\frac{\partial V}{\partial z}=-\left(RI+L\frac{\partial I}{\partial t}\right).$$ The negative sign indicates that voltage decreases in the positive $z$ direction because of resistive and inductive drops. Applying KCL at the section's central node gives the current equation $$\frac{\partial I}{\partial z}=-\left(GV+C\frac{\partial V}{\partial t}\right).$$ Current decreases because some current flows through dielectric conductance and charges the distributed capacitance. These coupled first-order partial differential equations are the telegraphist's equations. They describe how voltage and current jointly evolve with position and time on a uniform transmission line. Neither variable can generally be solved independently until the equations are combined into second-order wave equations.

### Key planning details

- KVL produces the spatial voltage-change equation.
- KCL produces the spatial current-change equation.
- Series resistance and inductance determine voltage variation.
- Shunt conductance and capacitance determine current variation.
- The two equations are coupled through both space and time derivatives.

### Source coverage

- Equations (1) through (5) on Page 319 derive $\partial V/\partial z=-(RI+L\,\partial I/\partial t)$.
- Equation (3) identifies $\Delta I=(\partial I/\partial z)\Delta z$ and $\Delta V=(\partial V/\partial z)\Delta z$.
- Equations (6) through (8) on Pages 319 and 320 derive $\partial I/\partial z=-(GV+C\,\partial V/\partial t)$.
- Page 320 identifies Equations (5) and (8) as the telegraphist's equations.
