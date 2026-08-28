---
title: "1.331 Receiving Antenna Equivalent Circuit and Matched Load"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 559", "Page 560", "Section 14.7.2", "Figure 14.17"]
related: ["antenna-reciprocity-and-identical-transmit-receive-patterns", "effective-area-and-the-transmit-receive-power-ratio", "half-wave-dipole-input-impedance-and-resonance"]
---

# 1.331 Receiving Antenna Equivalent Circuit and Matched Load

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 559, Page 560, Section 14.7.2, Figure 14.17

For widely separated transmitting and receiving antennas, reverse coupling can be neglected because the received current is much smaller than the transmitter current. The transmitter then satisfies $V_1=Z_{11}I_1$. At the receiving antenna, a load $Z_L$ is connected across the terminals and the forward-coupled voltage $Z_{21}I_1$ acts as the Thevenin source. With load current defined as $I_L=-I_2$, the receiving circuit obeys $V_L=Z_{21}I_1-Z_{22}I_L$, leading to $I_L=Z_{21}I_1/(Z_{22}+Z_L)$. The load power is $(1/2)|I_L|^2\operatorname{Re}\{Z_L\}$. Maximum average power transfer occurs when $Z_L=Z_{22}^*$, which cancels the receiver reactance and matches the load resistance to the antenna resistance. Under this condition, the received power is $P_L=|I_1|^2|Z_{21}|^2/(8R_{22})$. Comparing this with transmitted power $P_r=(1/2)R_{11}|I_1|^2$ gives $P_L/P_r=|Z_{21}|^2/(4R_{11}R_{22})$.

## Page-Grounded Details

#### Page 559

Figure 14.17 Transmitting and receiving antennas, and their equivalent circuits.

while antenna 2 is the receiver, at which the load is attached. A primary assumption is that the antennas are far enough away from each other so that only forward coupling (through $Z_{21}$) will be appreciable. The large separation distance means that the induced current $I_{2}$ is likely to be much less than $I_{1}$. Reverse coupling (through $Z_{12}$) would involve transmission of the received signal in antenna 2 back to antenna 1; specifically, the induced current $I_{2}$ further induces a (now very weak) additional current $I_{1}^{\prime}$ on antenna 1; that antenna would then carry a net current of $I_{1}+I_{1}^{\prime}$, where $I_{1}^{\prime}\ll I_{1}$. We therefore assume that the product $Z_{12}I_{2}$ can be neglected, under which Eq. (84a) gives $V_{1}=Z_{11}I_{1}$. A load impedance, $Z_{L}$, is connected across the terminals of antenna 2, as shown in the upper part of Figure 14.17. $V_{2}$ is the voltage across this load. Current $I_{L}=-I_{2}$ now flows through the load. Taking this current as positive, Eq. (84b) becomes
$$
V_{2}=V_{L}=Z_{21}I_{1}-Z_{22}I_{L}\qua

[Truncated for analysis]

#### Page 560

substitution in (90), and using the fact that $Z_{22}+Z_{22}^{*}=2R_{22}$ gives
$$
 P_{L}=\frac{1}{2}|I_{1}|^{2}\left|\frac{Z_{21}}{2R_{22}}\right|^{2}\mathcal{R}e\{Z_{22}\}=\frac{|I_{1}|^{2}|Z_{21}|^{2}}{8R_{22}}\quad{(91)}
$$
The time-average power transmitted by antenna 1 is
$$
 P_{r}=\frac{1}{2}\mathcal{R}e\left\{V_{1}I_{1}^{*}\right\}=\frac{1}{2}R_{11}|I_{1}|^{2}\quad{(92)}
$$
By comparing this result with Eq. (65), we can interpret $R_{11}$ as the radiation resistance of the transmitting antenna if (1) there are no resistive losses and (2) the current amplitude at the driving point is the maximum amplitude $I_{0}$. As we found earlier, the latter will occur in a dipole if the overall antenna length is an integer multiple of a half-wavelength. Using (91) and (92), we write the ratio of the received and transmitted powers:
$$
 \frac{P_{L}}{P_{r}}=\frac{|Z_{21}|^{2}}{4R_{11}R_{22}}\quad{(93)} $$
At this stage, more understanding is needed of the transimpedance, $Z_{21}$ (or $Z_{12}$). This quantity will depend on the distance and relative orientations of the two antennas, in addition to other parameters. Figure 14.18 shows two dipole antennas, separated by

Figure 1

[Truncated for analysis]

## Core Ideas

- Large antenna separation permits reverse coupling through $Z_{12}$ to be neglected.
- The induced source voltage at the receiver is $Z_{21}I_1$.
- The load current is $I_L=Z_{21}I_1/(Z_{22}+Z_L)$.
- Load power is $P_L=(1/2)|I_L|^2\operatorname{Re}\{Z_L\}$.
- Maximum power transfer requires $Z_L=Z_{22}^*$.
- Matched-load power is $P_L=|I_1|^2|Z_{21}|^2/(8R_{22})$.
- Transmitted power is $P_r=(1/2)R_{11}|I_1|^2$.
- The received-to-transmitted power ratio is $|Z_{21}|^2/(4R_{11}R_{22})$.

## Source Anchors

- Figure S26.P559.F14.17 shows the transmitting and receiving antennas and their equivalent circuits.
- Equation (88), Page 559 gives $V_L=Z_{21}I_1-Z_{22}I_L$.
- Equation (89), Page 559 gives the load current.
- Equation (90), Page 559 gives the general load-power expression.
- Equation (91), Page 560 gives matched-load received power.
- Equation (92), Page 560 gives transmitted power.
- Equation (93), Page 560 gives the received-to-transmitted power ratio.

## Related Pages

- [[antenna-reciprocity-and-identical-transmit-receive-patterns|Antenna Reciprocity and Identical Transmit-Receive Patterns]]
- [[effective-area-and-the-transmit-receive-power-ratio|Effective Area and the Transmit-Receive Power Ratio]]
- [[half-wave-dipole-input-impedance-and-resonance|Half-Wave Dipole Input Impedance and Resonance]]

## Concept Dependencies

- enables: [[effective-area-and-the-transmit-receive-power-ratio|Effective Area and the Transmit-Receive Power Ratio]]
