---
title: "1.330 Antenna Reciprocity and Identical Transmit-Receive Patterns"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 557", "Page 558", "Section 14.7", "Section 14.7.1", "Figure 14.16"]
related: ["receiving-antenna-equivalent-circuit-and-matched-load", "effective-area-and-the-transmit-receive-power-ratio", "hertzian-dipole-effective-area-setup"]
---

# 1.330 Antenna Reciprocity and Identical Transmit-Receive Patterns

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 557, Page 558, Section 14.7, Section 14.7.1, Figure 14.16

Two coupled antennas can be represented as a linear two-port network. Their terminal voltages and currents satisfy $V_1=Z_{11}I_1+Z_{12}I_2$ and $V_2=Z_{21}I_1+Z_{22}I_2$. The self-impedances $Z_{11}$ and $Z_{22}$ are the isolated antenna input impedances when the antennas are sufficiently separated, and their real parts equal radiation resistance when conductor and environmental losses vanish. The transimpedances describe coupling and depend on separation, relative orientation, and the surrounding medium. In a linear medium, reciprocity requires $Z_{12}=Z_{21}$, or equivalently $Y_{12}=Y_{21}$ in the admittance representation. Comparing experiments in which first one antenna and then the other is short-circuited produces equal transfer ratios. Because those ratios include both the transmitting antenna's radiation pattern and the receiving antenna's directional sensitivity, reversing the antenna roles can preserve equality only if each antenna has the same directional pattern in transmission and reception. Thus an antenna receives most strongly from the direction of its transmitting main beam.

## Page-Grounded Details

#### Page 557

D14.8. In an endfire linear dipole array in which $\xi=-kd$, what minimum element spacing $d$ in wavelengths results in bidirectional operation, in which equal intensities occur in the $H$ plane at $\phi=0$ and $\phi=\pi$?

Ans. $d=\lambda/2$

D14.9. For a linear dipole array in which the element spacing is $d=\lambda/4$, what current phase $\xi$ will result in a main beam in the direction of (a) $\phi=30^{\circ}$; (b) $\phi=45^{\circ}$?

Ans. (a) $-\pi\sqrt{3}/4$; (b) $-\pi\sqrt{2}/4$

#### 14.7 ANTENNAS AS RECEIVERS

We next turn to the other fundamental purpose of an antenna, which is its use as a means to detect, or receive, radiation that originates from a distant source. We will approach this problem through study of a transmit-receive antenna system. This is composed of two antennas, along with their supporting electronics, that play the interchangeable roles of transmitter and detector.

#### 14.7.1 Transmit-Receive Link as a Two-Port Network: Reciprocity

Figure 14.16 shows an example of a transmit-receive arrangement, in which the two coupled antennas together comprise a linear two-port network. Voltage $V_{1}$ and current $I_{1}$ on the antenn

[Truncated for analysis]

#### Page 558

far away from each other. The real parts of $Z_{11}$ and $Z_{22}$ will be the associated radiation resistances, provided ohmic losses in all conductors and all losses to surrounding objects are reduced to zero. We will assume this, in addition to far-zone operation, to be true here. The trans-impedances, $Z_{12}$ and $Z_{21}$, depend on the spacing and relative orientation between the antennas, as well as on the characteristics of the surrounding medium. A critical property of the transimpedances in a linear medium is that they are equal. This property is the embodiment of the reciprocity theorem. Stated simply,
$$
Z_{12}=Z_{21}\quad{(85)}
$$
Further insights can be found by inverting (84a) and (84b) and invoking the admit-tance parameters, $Y_{ij}$:
$$
I_{1}=Y_{11}\,V_{1}+Y_{12}\,V_{2}\quad{(86a)}
$$
$$
I_{2}=Y_{21}\,V_{1}+Y_{22}\,V_{2}\quad{(86b)}
$$
where, again, the reciprocity theorem tells us that $Y_{12}=Y_{21}$.

Now, suppose that the terminals of antenna 2 are shorted, so that $V_{2}=0$. In this case, Eq. (86b) gives $I_{2}^{{}^{\prime}}=Y_{21}\,V_{1}^{{}^{\prime}}$, where the single prime denotes the condition of a shorted antenna 2. Instead, we could

[Truncated for analysis]

## Core Ideas

- A pair of coupled antennas forms a linear two-port network.
- The self-impedances are $Z_{11}$ and $Z_{22}$.
- The coupling terms are the transimpedances $Z_{12}$ and $Z_{21}$.
- In a linear reciprocal medium, $Z_{12}=Z_{21}$.
- The admittance parameters similarly satisfy $Y_{12}=Y_{21}$.
- The transimpedances depend on spacing, orientation, and medium properties.
- Short-circuit transfer ratios remain equal when transmitter and receiver roles are exchanged.
- An antenna's radiation pattern and reception pattern are identical.

## Source Anchors

- Figure S26.P557.F14.16 depicts two coupled antennas as a two-port network.
- Equations (84a) and (84b), Page 557 give the impedance-parameter equations.
- Equation (85), Page 558 states $Z_{12}=Z_{21}$.
- Equations (86a) and (86b), Page 558 give the admittance representation.
- Equation (87), Page 558 equates the transfer ratios obtained with alternate antennas shorted.
- Page 558 concludes that the radiation and receiving patterns of any antenna are the same.

## Related Pages

- [[receiving-antenna-equivalent-circuit-and-matched-load|Receiving Antenna Equivalent Circuit and Matched Load]]
- [[effective-area-and-the-transmit-receive-power-ratio|Effective Area and the Transmit-Receive Power Ratio]]
- [[hertzian-dipole-effective-area-setup|Hertzian Dipole Effective Area Setup]]

## Concept Dependencies

- enables: [[receiving-antenna-equivalent-circuit-and-matched-load|Receiving Antenna Equivalent Circuit and Matched Load]]
