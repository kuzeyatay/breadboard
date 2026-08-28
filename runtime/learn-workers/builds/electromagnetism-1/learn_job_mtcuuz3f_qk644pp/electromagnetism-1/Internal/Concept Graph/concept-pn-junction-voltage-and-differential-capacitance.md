---
title: "pn Junction Voltage and Differential Capacitance"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "pn-junction-voltage-and-differential-capacitance"
locations: ["Page 185", "Page 186"]
related: ["one-dimensional-poisson-solution-for-a-pn-junction", "potential-to-charge-capacitance-workflow", "capacitor-geometry-and-dielectric-design-problems"]
---

## ConceptNode: pn Junction Voltage and Differential Capacitance

Planning node for [[pn-junction-voltage-and-differential-capacitance|1.97 pn Junction Voltage and Differential Capacitance]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 185, Page 186

The smooth pn-junction solution links depletion width, built-in voltage, charge, and differential capacitance. The potential becomes nearly constant about $4a$ to $5a$ from the junction. Taking the difference between the asymptotic potentials gives $$V_0=\frac{2\pi\rho_{v0}a^2}{\epsilon}.$$ Integrating the positive charge density over the n side and multiplying by junction area $S$ gives $$Q=2\rho_{v0}aS.$$ Eliminating $a$ yields $$Q=S\sqrt{\frac{2\rho_{v0}\epsilon V_0}{\pi}}.$$ Because charge is not proportional to voltage, the junction capacitance is not defined as a constant ratio $Q/V_0$. Using the circuit relation $I=dQ/dt=C\,dV_0/dt$ gives the differential definition $C=dQ/dV_0$. Differentiation produces $$C=S\sqrt{\frac{\rho_{v0}\epsilon}{2\pi V_0}}=\frac{\epsilon S}{2\pi a}.$$ Thus, capacitance decreases as $V_0^{-1/2}$. The second form resembles a parallel-plate capacitor with an effective separation $2\pi a$.

### Key planning details

- The junction potential is nearly constant beyond about $4a$ to $5a$.
- The total voltage is $V_0=2\pi\rho_{v0}a^2/\epsilon$.
- The positive-side charge is $Q=2\rho_{v0}aS$.
- Eliminating $a$ gives $Q\propto\sqrt{V_0}$.
- Junction capacitance must be defined as $dQ/dV_0$.
- The capacitance varies as $V_0^{-1/2}$.
- The effective parallel-plate separation is $2\pi a$.

### Source coverage

- Equation (47) gives the asymptotic potential difference.
- The positive charge integral gives $Q=2\rho_{v0}aS$.
- Equation (48) gives $Q=S\sqrt{2\rho_{v0}\epsilon V_0/\pi}$.
- The source derives $C=dQ/dV_0$ from $I=dQ/dt$.
- Equation (49) gives both capacitance forms.
- Problem D6.7 gives a numerical junction with answers $V_0=2.70\ \mathrm{V}$, $C=8.85\ \mathrm{pF}$, and $E=2.70\ \mathrm{MV/m}$.
