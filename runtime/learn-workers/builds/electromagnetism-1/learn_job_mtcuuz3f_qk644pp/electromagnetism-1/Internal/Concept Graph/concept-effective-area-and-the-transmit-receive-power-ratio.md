---
title: "Effective Area and the Transmit-Receive Power Ratio"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "effective-area-and-the-transmit-receive-power-ratio"
locations: ["Page 560", "Page 561", "Page 562", "Section 14.7.2", "Figure 14.18"]
related: ["antenna-reciprocity-and-identical-transmit-receive-patterns", "receiving-antenna-equivalent-circuit-and-matched-load", "hertzian-dipole-effective-area-setup", "radiation-intensity-directivity-and-radiation-resistance"]
---

## ConceptNode: Effective Area and the Transmit-Receive Power Ratio

Planning node for [[effective-area-and-the-transmit-receive-power-ratio|1.332 Effective Area and the Transmit-Receive Power Ratio]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 560, Page 561, Page 562, Section 14.7.2, Figure 14.18

Effective area $A_e(\theta,\phi)$ measures how much power a receiving antenna delivers to a matched load from an incident power density. It is defined by $P_L=S_rA_e$, so it has units of square metres and includes directional dependence. For a transmitter radiating power $P_{r1}$ with directivity $D_1(\theta_1,\phi_1)$, the far-zone power density at range $r$ is $S_{r1}=P_{r1}D_1/(4\pi r^2)$. Combining these relations gives $P_{L2}/P_{r1}=A_{e2}D_1/(4\pi r^2)$. Equating this field-based expression with the two-port result yields a formula for $|Z_{21}|^2$ in terms of both antennas' radiation resistances, transmitter directivity, receiver effective area, and range. Reversing transmitter and receiver produces a corresponding expression for $|Z_{12}|^2$. Reciprocity then requires the ratios $D_1/A_{e1}$ and $D_2/A_{e2}$ to be equal. The source concludes that directivity divided by effective area is a universal constant, independent of antenna type and evaluation direction, although this chunk ends while the constant is being evaluated.

### Key planning details

- Effective area is defined by $P_L=S_rA_e$ for a matched receiving load.
- Effective area has units of square metres.
- Transmitter power density is $S_r=P_rD/(4\pi r^2)$.
- The link ratio is $P_{L2}/P_{r1}=A_{e2}D_1/(4\pi r^2)$.
- The same ratio equals $|Z_{21}|^2/(4R_{11}R_{22})$.
- Reciprocity allows the transmit and receive roles to be reversed.
- The ratio $D(\theta,\phi)/A_e(\theta,\phi)$ is universal.
- The source begins evaluating the universal constant using a Hertzian dipole.

### Source coverage

- Figure S26.P560.F14.18 identifies the relative orientation angles and incident field at the receiving dipole.
- Equation (94), Page 561 defines $P_{L2}=S_{r1}A_{e2}$.
- Equation (95), Page 561 gives $S_{r1}=P_{r1}D_1/(4\pi r^2)$.
- Equation (96), Page 561 gives the received-to-radiated power ratio in both effective-area and transimpedance forms.
- Equations (97a) and (97b), Pages 561 and 562 express the reciprocal transimpedances.
- Equation (98), Page 562 states $D_1/A_{e1}=D_2/A_{e2}=\text{Constant}$.
