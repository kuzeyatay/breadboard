---
title: "1.332 Effective Area and the Transmit-Receive Power Ratio"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 560", "Page 561", "Page 562", "Section 14.7.2", "Figure 14.18"]
related: ["antenna-reciprocity-and-identical-transmit-receive-patterns", "receiving-antenna-equivalent-circuit-and-matched-load", "hertzian-dipole-effective-area-setup", "radiation-intensity-directivity-and-radiation-resistance"]
---

# 1.332 Effective Area and the Transmit-Receive Power Ratio

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 560, Page 561, Page 562, Section 14.7.2, Figure 14.18

Effective area $A_e(\theta,\phi)$ measures how much power a receiving antenna delivers to a matched load from an incident power density. It is defined by $P_L=S_rA_e$, so it has units of square metres and includes directional dependence. For a transmitter radiating power $P_{r1}$ with directivity $D_1(\theta_1,\phi_1)$, the far-zone power density at range $r$ is $S_{r1}=P_{r1}D_1/(4\pi r^2)$. Combining these relations gives $P_{L2}/P_{r1}=A_{e2}D_1/(4\pi r^2)$. Equating this field-based expression with the two-port result yields a formula for $|Z_{21}|^2$ in terms of both antennas' radiation resistances, transmitter directivity, receiver effective area, and range. Reversing transmitter and receiver produces a corresponding expression for $|Z_{12}|^2$. Reciprocity then requires the ratios $D_1/A_{e1}$ and $D_2/A_{e2}$ to be equal. The source concludes that directivity divided by effective area is a universal constant, independent of antenna type and evaluation direction, although this chunk ends while the constant is being evaluated.

## Page-Grounded Details

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
\frac{P_{L}}{P_{r}}=\frac{|Z_{21}|^{2}}{4R_{11}R_{22}}\quad{(93)}
$$
At this stage, more understanding is needed of the transimpedance, $Z_{21}$ (or $Z_{12}$). This quantity will depend on the distance and relative orientations of the two antennas, in addition to other parameters. Figure 14.18 shows two dipole antennas, separated by

Figure 1

[Truncated for analysis]

#### Page 561

radial distance $r$, and with relative orientations that are specified by values of $\theta$, as measured with respect to each antenna axis.$^{5}$ With antenna 1 serving as the transmitter and antenna 2 serving as the receiver, the radiation pattern of antenna 1 is given as a function of $\theta_{1}$ and $\phi_{1}$, while the receiving pattern of antenna 2 (equivalent to its radiation pattern) is given as a function of $\theta_{2}$ and $\phi_{2}$.

A convenient way to express the received power in an antenna is through its effective area, denoted $A_{e}(\theta,\phi)$ and expressed in $m^{2}$. Refer to Figure 14.18, and consider the average power density at the receiver (antenna 2) position, originating from the transmitter (antenna 1). As per Eqs. (25) and (26), this will be the magnitude of the Poynting vector at that location, $S_{r}(r,\theta_{1},\phi_{1})$ in $W/m^{2}$, where a dependence on $\phi$ is now necessary to describe all possible relative orientations. The effective area of the receiving antenna is defined such that when the power density is multiplied by the effective area, the power dissipated by a matched load at the receiving antenna is obta

[Truncated for analysis]

#### Page 562

The reciprocity theorem states that $Z_{12}=Z_{21}$. By equating Eqs. (97a) and (97b), it therefore follows that
$$
\frac{D_{1}(\theta_{1}, \phi_{1})}{A_{e1}(\theta_{1}, \phi_{1})} = \frac{D_{2}(\theta_{2}, \phi_{2})}{A_{e2}(\theta_{2}, \phi_{2})} = \text{Constant} \quad{(98)}
$$
That is, the ratio of directivity to effective area for any antenna is a universal constant, independent of the antenna type or the direction in which these parameters are evaluated. To evaluate the constant, we only need to look at one case.

#### Example 14.6

Find the effective area of a Hertzian dipole, and determine the general relation between the directivity and effective area of any antenna.

Solution. With the Hertzian dipole as the receiving antenna, and having length d, its load voltage $V_{L}$ will depend on the electric field that it intercepts from antenna 1. Specifically, we find the projection of the transmitting antenna field along the length of receiving antenna. This projected field, when multiplied by the length of antenna 2, gives the input voltage to the receiving antenna equivalent circuit. Referring to Figure 14.18, the projection angle is $\alpha$, and thus the voltage that

[Truncated for analysis]

## Core Ideas

- Effective area is defined by $P_L=S_rA_e$ for a matched receiving load.
- Effective area has units of square metres.
- Transmitter power density is $S_r=P_rD/(4\pi r^2)$.
- The link ratio is $P_{L2}/P_{r1}=A_{e2}D_1/(4\pi r^2)$.
- The same ratio equals $|Z_{21}|^2/(4R_{11}R_{22})$.
- Reciprocity allows the transmit and receive roles to be reversed.
- The ratio $D(\theta,\phi)/A_e(\theta,\phi)$ is universal.
- The source begins evaluating the universal constant using a Hertzian dipole.

## Source Anchors

- Figure S26.P560.F14.18 identifies the relative orientation angles and incident field at the receiving dipole.
- Equation (94), Page 561 defines $P_{L2}=S_{r1}A_{e2}$.
- Equation (95), Page 561 gives $S_{r1}=P_{r1}D_1/(4\pi r^2)$.
- Equation (96), Page 561 gives the received-to-radiated power ratio in both effective-area and transimpedance forms.
- Equations (97a) and (97b), Pages 561 and 562 express the reciprocal transimpedances.
- Equation (98), Page 562 states $D_1/A_{e1}=D_2/A_{e2}=\text{Constant}$.

## Related Pages

- [[antenna-reciprocity-and-identical-transmit-receive-patterns|Antenna Reciprocity and Identical Transmit-Receive Patterns]]
- [[receiving-antenna-equivalent-circuit-and-matched-load|Receiving Antenna Equivalent Circuit and Matched Load]]
- [[hertzian-dipole-effective-area-setup|Hertzian Dipole Effective Area Setup]]
- [[radiation-intensity-directivity-and-radiation-resistance|Radiation Intensity, Directivity, and Radiation Resistance]]

## Concept Dependencies

- depends-on: [[antenna-reciprocity-and-identical-transmit-receive-patterns|Antenna Reciprocity and Identical Transmit-Receive Patterns]]
- depends-on: [[radiation-intensity-directivity-and-radiation-resistance|Radiation Intensity, Directivity, and Radiation Resistance]]
