---
title: "Initially Charged Lines and Pulse Formation"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "initially-charged-lines-and-pulse-formation"
locations: ["Page 368", "Page 369", "Page 370"]
related: ["matched-line-step-propagation-and-transit-delay", "multiple-reflections-and-transient-steady-state", "voltage-and-current-reflection-diagrams"]
---

## ConceptNode: Initially Charged Lines and Pulse Formation

Planning node for [[initially-charged-lines-and-pulse-formation|1.205 Initially Charged Lines and Pulse Formation]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 368, Page 369, Page 370

An initially charged transmission line can discharge through a resistor and act as a pulse-forming line. If the line begins at voltage $V_0$ and a resistor $R_g$ is switched across one end, a voltage wave travels toward the open end. The wave must have polarity opposite to $V_0$ because it reduces the voltage behind its front. Current continuity and the resistor voltage relation give $$V_1^+=-\frac{V_0Z_0}{Z_0+R_g}.$$ The open end has $\Gamma_L=1$, while reflections at the resistor depend on $\Gamma_g=(R_g-Z_0)/(R_g+Z_0)$. If $R_g=Z_0$, then $V_1^+=-V_0/2$ and the reflected wave from the open end completes the discharge in one round trip. The resistor receives a rectangular pulse of amplitude $V_0/2$ and duration $2l/v$. If the resistor is mismatched, discharge still completes but requires multiple reflections and produces a more complicated waveform. Example 10.12 begins such a sequence for $Z_0=100\ \Omega$, $R_g=100/3\ \Omega$, and $V_0=160$ V.

### Key planning details

- An initially charged line stores distributed electric and magnetic energy.
- Closing the discharge switch launches a voltage wave opposite in polarity to the initial voltage.
- The initial discharge wave is $$V_1^+=-\frac{V_0Z_0}{Z_0+R_g}.$$
- The open end reflects voltage with $\Gamma_L=1$.
- A matched discharge resistor has $R_g=Z_0$ and $\Gamma_g=0$.
- With a matched resistor, the pulse amplitude is $V_0/2$.
- The matched-line pulse duration is $2l/v$.
- A mismatched resistor produces a staircase-like sequence of multiple reflections.

### Source coverage

- Source figure S1.P368.F1, Figure 10.25, shows the initially charged line and the opposite-polarity discharge wave.
- Pages 368 and 369 explain why $V_1^+$ must be negative relative to $V_0$.
- Page 369 derives $V_1^+=-V_0Z_0/(Z_0+R_g)$ as Eq. (122).
- Source figure S1.P369.F1, Figure 10.26, shows the voltage reflection diagram with initial voltage $V_0$ on the time-zero axis.
- Source figure S1.P370.F1, Figure 10.27, shows the matched-resistor pulse of amplitude $V_0/2$ and duration $2l/v$.
- Page 370 identifies this device as a pulse-forming line and notes nanosecond-scale commercial pulse generation.
- Page 370 begins Example 10.12 with $\Gamma_g=-1/2$, $V_1^+=V_1^-=-120$ V, $V_2^+=V_2^-=60$ V, $V_3^+=V_3^-=-30$ V, and $V_4^+=V_4^-=15$ V.
