---
title: "Receiving Antenna Equivalent Circuit and Matched Load"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "receiving-antenna-equivalent-circuit-and-matched-load"
locations: ["Page 559", "Page 560", "Section 14.7.2", "Figure 14.17"]
related: ["antenna-reciprocity-and-identical-transmit-receive-patterns", "effective-area-and-the-transmit-receive-power-ratio", "half-wave-dipole-input-impedance-and-resonance"]
---

## ConceptNode: Receiving Antenna Equivalent Circuit and Matched Load

Planning node for [[receiving-antenna-equivalent-circuit-and-matched-load|1.331 Receiving Antenna Equivalent Circuit and Matched Load]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 559, Page 560, Section 14.7.2, Figure 14.17

For widely separated transmitting and receiving antennas, reverse coupling can be neglected because the received current is much smaller than the transmitter current. The transmitter then satisfies $V_1=Z_{11}I_1$. At the receiving antenna, a load $Z_L$ is connected across the terminals and the forward-coupled voltage $Z_{21}I_1$ acts as the Thevenin source. With load current defined as $I_L=-I_2$, the receiving circuit obeys $V_L=Z_{21}I_1-Z_{22}I_L$, leading to $I_L=Z_{21}I_1/(Z_{22}+Z_L)$. The load power is $(1/2)|I_L|^2\operatorname{Re}\{Z_L\}$. Maximum average power transfer occurs when $Z_L=Z_{22}^*$, which cancels the receiver reactance and matches the load resistance to the antenna resistance. Under this condition, the received power is $P_L=|I_1|^2|Z_{21}|^2/(8R_{22})$. Comparing this with transmitted power $P_r=(1/2)R_{11}|I_1|^2$ gives $P_L/P_r=|Z_{21}|^2/(4R_{11}R_{22})$.

### Key planning details

- Large antenna separation permits reverse coupling through $Z_{12}$ to be neglected.
- The induced source voltage at the receiver is $Z_{21}I_1$.
- The load current is $I_L=Z_{21}I_1/(Z_{22}+Z_L)$.
- Load power is $P_L=(1/2)|I_L|^2\operatorname{Re}\{Z_L\}$.
- Maximum power transfer requires $Z_L=Z_{22}^*$.
- Matched-load power is $P_L=|I_1|^2|Z_{21}|^2/(8R_{22})$.
- Transmitted power is $P_r=(1/2)R_{11}|I_1|^2$.
- The received-to-transmitted power ratio is $|Z_{21}|^2/(4R_{11}R_{22})$.

### Source coverage

- Figure S26.P559.F14.17 shows the transmitting and receiving antennas and their equivalent circuits.
- Equation (88), Page 559 gives $V_L=Z_{21}I_1-Z_{22}I_L$.
- Equation (89), Page 559 gives the load current.
- Equation (90), Page 559 gives the general load-power expression.
- Equation (91), Page 560 gives matched-load received power.
- Equation (92), Page 560 gives transmitted power.
- Equation (93), Page 560 gives the received-to-transmitted power ratio.
