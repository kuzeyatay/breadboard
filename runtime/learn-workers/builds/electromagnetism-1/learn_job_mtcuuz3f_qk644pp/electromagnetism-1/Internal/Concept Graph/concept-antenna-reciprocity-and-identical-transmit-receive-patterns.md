---
title: "Antenna Reciprocity and Identical Transmit-Receive Patterns"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "antenna-reciprocity-and-identical-transmit-receive-patterns"
locations: ["Page 557", "Page 558", "Section 14.7", "Section 14.7.1", "Figure 14.16"]
related: ["receiving-antenna-equivalent-circuit-and-matched-load", "effective-area-and-the-transmit-receive-power-ratio", "hertzian-dipole-effective-area-setup"]
---

## ConceptNode: Antenna Reciprocity and Identical Transmit-Receive Patterns

Planning node for [[antenna-reciprocity-and-identical-transmit-receive-patterns|1.330 Antenna Reciprocity and Identical Transmit-Receive Patterns]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 557, Page 558, Section 14.7, Section 14.7.1, Figure 14.16

Two coupled antennas can be represented as a linear two-port network. Their terminal voltages and currents satisfy $V_1=Z_{11}I_1+Z_{12}I_2$ and $V_2=Z_{21}I_1+Z_{22}I_2$. The self-impedances $Z_{11}$ and $Z_{22}$ are the isolated antenna input impedances when the antennas are sufficiently separated, and their real parts equal radiation resistance when conductor and environmental losses vanish. The transimpedances describe coupling and depend on separation, relative orientation, and the surrounding medium. In a linear medium, reciprocity requires $Z_{12}=Z_{21}$, or equivalently $Y_{12}=Y_{21}$ in the admittance representation. Comparing experiments in which first one antenna and then the other is short-circuited produces equal transfer ratios. Because those ratios include both the transmitting antenna's radiation pattern and the receiving antenna's directional sensitivity, reversing the antenna roles can preserve equality only if each antenna has the same directional pattern in transmission and reception. Thus an antenna receives most strongly from the direction of its transmitting main beam.

### Key planning details

- A pair of coupled antennas forms a linear two-port network.
- The self-impedances are $Z_{11}$ and $Z_{22}$.
- The coupling terms are the transimpedances $Z_{12}$ and $Z_{21}$.
- In a linear reciprocal medium, $Z_{12}=Z_{21}$.
- The admittance parameters similarly satisfy $Y_{12}=Y_{21}$.
- The transimpedances depend on spacing, orientation, and medium properties.
- Short-circuit transfer ratios remain equal when transmitter and receiver roles are exchanged.
- An antenna's radiation pattern and reception pattern are identical.

### Source coverage

- Figure S26.P557.F14.16 depicts two coupled antennas as a two-port network.
- Equations (84a) and (84b), Page 557 give the impedance-parameter equations.
- Equation (85), Page 558 states $Z_{12}=Z_{21}$.
- Equations (86a) and (86b), Page 558 give the admittance representation.
- Equation (87), Page 558 equates the transfer ratios obtained with alternate antennas shorted.
- Page 558 concludes that the radiation and receiving patterns of any antenna are the same.
