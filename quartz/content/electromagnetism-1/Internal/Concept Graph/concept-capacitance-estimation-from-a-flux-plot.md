---
title: "Capacitance Estimation from a Flux Plot"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "capacitance-estimation-from-a-flux-plot"
locations: ["Page 171", "Page 172", "Page 173"]
related: ["curvilinear-square-field-map-construction", "practical-field-map-refinement-procedure", "potential-to-charge-capacitance-workflow"]
---

## ConceptNode: Capacitance Estimation from a Flux Plot

Planning node for [[capacitance-estimation-from-a-flux-plot|1.87 Capacitance Estimation from a Flux Plot]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 171, Page 172, Page 173

A curvilinear-square field map converts capacitance estimation into counting flux tubes and potential increments. Starting from $C=Q/V_0$, the total charge is represented as $Q=N_Q\Delta Q=N_Q\Delta\Psi$, where $N_Q$ is the number of flux tubes joining the conductors. The total voltage is represented as $V_0=N_V\Delta V$, where $N_V$ is the number of equal potential increments between conductors. Combining these expressions with the local field-map relation gives $$C=\frac{N_Q}{N_V}\epsilon\frac{\Delta L_t}{\Delta L_N}.$$ For a curvilinear-square map, $\Delta L_t/\Delta L_N=1$, so the result reduces to $$C=\epsilon\frac{N_Q}{N_V}.$$ Thus, capacitance per unit length can be estimated by counting divisions around a conductor and between conductors. In the square-inner, circular-outer conductor example, the map has $N_V=4$ and $N_Q=8\times3.25=26$. With free-space permittivity, the estimate is $57.6\ \mathrm{pF/m}$.

### Key planning details

- Total charge is represented by $Q=N_Q\Delta Q$.
- Total voltage is represented by $V_0=N_V\Delta V$.
- The general map relation is $C=(N_Q/N_V)\epsilon(\Delta L_t/\Delta L_N)$.
- Curvilinear squares reduce the relation to $C=\epsilon N_Q/N_V$.
- $N_Q$ counts flux tubes around a conductor.
- $N_V$ counts potential increments between conductors.
- The Figure 6.8 map gives $N_Q=26$, $N_V=4$, and $C=57.6\ \mathrm{pF/m}$.

### Source coverage

- S1.P172.F1, Figure 6.8 maps a square inner conductor surrounded by a circular conductor.
- The square side is two-thirds the radius of the outer circle.
- The source states $N_V=4$ and $N_Q=8\times3.25=26$.
- Equation (20) gives $C=\epsilon N_Q/N_V$ when $\Delta L_t/\Delta L_N=1$.
- The numerical calculation is $$C=\epsilon_0\frac{8\times3.25}{4}=57.6\ \mathrm{pF/m}.$$
- Problem D6.4 reports a field-map estimate of $69\ \mathrm{pF/m}$ for two circular cylinders.
