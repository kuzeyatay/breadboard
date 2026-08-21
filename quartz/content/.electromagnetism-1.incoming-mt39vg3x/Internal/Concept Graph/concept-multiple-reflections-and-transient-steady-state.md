---
title: "Multiple Reflections and Transient Steady State"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "multiple-reflections-and-transient-steady-state"
locations: ["Page 361", "Page 362"]
related: ["matched-line-step-propagation-and-transit-delay", "voltage-and-current-reflection-diagrams", "worked-transient-with-a-matched-generator", "forward-and-reflected-voltage-reconstruction"]
---

## ConceptNode: Multiple Reflections and Transient Steady State

Planning node for [[multiple-reflections-and-transient-steady-state|1.202 Multiple Reflections and Transient Steady State]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 361, Page 362

When a step reaches a mismatched resistive load, it generates a backward wave according to $$\Gamma_L=\frac{R_L-Z_0}{R_L+Z_0},\qquad V_1^-=\Gamma_LV_1^+.$$ The backward wave returns to the source, where it reflects according to $$\Gamma_g=\frac{Z_g-Z_0}{Z_g+Z_0}.$$ An ideal battery has $Z_g=0$ and therefore $\Gamma_g=-1$. Successive waves are products of the load and generator reflection coefficients. Summing all load arrivals gives a geometric series whose steady-state limit is $$V_L=V_1^+\frac{1+\Gamma_L}{1-\Gamma_g\Gamma_L}.$$ For an ideal battery directly connected to the line, $V_1^+=V_0$ and the result reduces to $V_L=V_0$. If the battery has series resistance $R_g$, the initially launched wave is set by voltage division: $$V_1^+=\frac{V_0Z_0}{R_g+Z_0},$$ and the source reflection coefficient becomes $(R_g-Z_0)/(R_g+Z_0)$. Repeated reflections then converge to the ordinary lumped-circuit steady state.

### Key planning details

- The load reflection coefficient controls each reflection at the load.
- The generator reflection coefficient controls each reflection at the source.
- An ideal voltage source has $\Gamma_g=-1$.
- A source matched to the line has $\Gamma_g=0$.
- Each round trip introduces another factor of $\Gamma_g\Gamma_L$.
- The load-voltage sequence forms a geometric series.
- The steady-state load voltage is $$V_L=V_1^+\frac{1+\Gamma_L}{1-\Gamma_g\Gamma_L}.$$
- A series source resistance reduces the initial launched voltage by voltage division.

### Source coverage

- Page 361 gives the resistive-load reflection coefficient as Eq. (115).
- Page 361 gives the ideal-battery reflection coefficient $\Gamma_g=-1$ as Eq. (116).
- Pages 361 and 362 express load voltage as a sequence of incident and reflected waves.
- Page 361 factors the sequence into Eq. (117).
- Page 362 evaluates the geometric series to obtain the steady-state load voltage.
- Source figure S1.P362.F1, Figure 10.20, shows a battery with series resistance and the first reflected wave.
- Page 362 gives $V_1^+=V_0Z_0/(R_g+Z_0)$ and $\Gamma_g=(R_g-Z_0)/(R_g+Z_0)$.
