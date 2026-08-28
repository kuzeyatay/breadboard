---
title: "Charged-Line Transients and Reflection Diagrams"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "charged-line-transients-and-reflection-diagrams"
locations: ["Page 371", "Page 372", "Page 379", "Page 380"]
related: ["transmission-line-reflection-and-standing-wave-analysis", "wave-superposition-and-current-standing-waves", "traveling-wave-direction-and-sinusoidal-solutions"]
---

## ConceptNode: Charged-Line Transients and Reflection Diagrams

Planning node for [[charged-line-transients-and-reflection-diagrams|1.206 Charged-Line Transients and Reflection Diagrams]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 371, Page 372, Page 379, Page 380

A charged transmission line responds to switching through a sequence of forward- and backward-traveling voltage and current waves. The terminal voltage during each interval is found by moving along the appropriate axis of a reflection diagram and summing every wave that has reached that terminal. In the worked case, the resistor voltage changes after each round-trip interval of duration $2l/v$, taking the successive values $40$ V, $-20$ V, $10$ V, and $-5$ V. Current waves are obtained from their associated voltage waves using the characteristic impedance, with the sign depending on propagation direction. The resistor current can also be checked by dividing the plotted resistor voltage by $-R_g$ for the circuit orientation used in the example. Boundary conditions provide an independent validation: because the opposite end is open, its total current must remain zero at every time. The chapter problems generalize this method to mismatched source and load resistances, finite-duration pulses, switches placed inside a line, frozen-wave generators, and networks whose source and load voltages and battery currents must all be plotted.

### Key planning details

- Terminal values are cumulative sums of all wave components that have arrived by a given time.
- Successive terminal changes occur at line transit or round-trip times determined by $l/v$.
- For a voltage wave, current magnitude is related by $|I|=|V|/Z_0$.
- Forward and backward current waves use opposite voltage-to-current sign conventions.
- An open-circuit termination requires the total current at that end to be zero for all time.
- Opening a switch can launch a second wave chosen to leave zero current behind it.
- Reflection diagrams can produce piecewise plots of load voltage, source voltage, resistor current, and battery current.

### Source coverage

- For $0<t<2l/v$, the resistor voltage is $V_R=V_0+V_1^+=40\,\mathrm{V}$.
- For $2l/v<t<4l/v$, the cumulative resistor voltage is $-20\,\mathrm{V}$; the next two intervals give $10\,\mathrm{V}$ and $-5\,\mathrm{V}$.
- The listed current waves include $I_1^+=-1.2\,\mathrm{A}$, $I_1^-=+1.2\,\mathrm{A}$, $I_2^+=-I_2^-=+0.6\,\mathrm{A}$, $I_3^+=-I_3^-=-0.30\,\mathrm{A}$, and $I_4^+=-I_4^-=+0.15\,\mathrm{A}$.
- Figure 10.28 shows resistor voltage and current versus time and should be retained as source figures S1.P371.F1 and S1.P372.F1 for a regenerable reflection-timeline visual.
- Problem 10.39 states that opening the switch initiates a second voltage wave whose value leaves a net current of zero in its wake.
- Problems 10.37 through 10.43 request voltage and current reflection diagrams for several switched-line configurations.
- Figures 10.37, 10.38, and 10.39 should be retained as S1.P379.F1, S1.P380.F1, and S1.P380.F2 and attached to their switched-line procedures.
