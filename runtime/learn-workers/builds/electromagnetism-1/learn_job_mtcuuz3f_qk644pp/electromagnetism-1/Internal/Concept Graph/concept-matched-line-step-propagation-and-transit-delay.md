---
title: "Matched-Line Step Propagation and Transit Delay"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "matched-line-step-propagation-and-transit-delay"
locations: ["Page 359", "Page 360", "Page 361"]
related: ["multiple-reflections-and-transient-steady-state", "voltage-and-current-reflection-diagrams", "initially-charged-lines-and-pulse-formation"]
---

## ConceptNode: Matched-Line Step Propagation and Transit Delay

Planning node for [[matched-line-step-propagation-and-transit-delay|1.201 Matched-Line Step Propagation and Transit Delay]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 359, Page 360, Page 361

Transient analysis replaces the single-frequency steady-state assumption with propagating steps and pulses. The basic treatment assumes a lossless, nondispersive line, even though real pulses contain many Fourier components and can broaden when $\beta$ or the load reflection coefficient varies with frequency. For a line of length $l$ terminated in $R_L=Z_0$, closing a battery switch at $t=0$ launches a forward voltage step $V^+=V_0$. Behind the leading edge, the line voltage is $V_0$; ahead of it, the line remains at zero voltage. The edge travels at velocity $v$, generally the group velocity, and reaches the load after the one-way transit time $l/v$. Because the load is matched, no reflection occurs and the transient ends when the wave arrives. The associated current step is $I^+=V^+/Z_0$. Thus the load voltage and current remain zero until $t=l/v$, then become $V_0$ and $V_0/R_L$, respectively.

### Key planning details

- Transient signals contain many frequency components even when represented as simple steps or pulses.
- Frequency-dependent $\beta(\omega)$ can produce pulse broadening.
- A switched source launches a propagating voltage step rather than changing the entire line instantaneously.
- The one-way transit time is $l/v$.
- Behind the forward edge, $V=V^+$ and $I=V^+/Z_0$.
- Ahead of the edge, voltage and current retain their initial values.
- A matched load has no reflected wave.

### Source coverage

- Page 359 introduces transient analysis for steps, pulses, digital signals, and line energy storage.
- Page 359 limits the initial treatment to lossless, nondispersive lines and discusses frequency-dependent $\beta(\omega)$ and pulse broadening.
- Source figure S1.P360.F1, Figure 10.19a, shows the propagating voltage and current leading edges.
- Source figure S1.P360.F2, Figure 10.19b, shows the load-voltage delay $l/v$.
- Pages 360 and 361 state $V^+=V_0$ and $I^+=V^+/Z_0$.
- Page 361 explains that the matched load produces no reflection.
