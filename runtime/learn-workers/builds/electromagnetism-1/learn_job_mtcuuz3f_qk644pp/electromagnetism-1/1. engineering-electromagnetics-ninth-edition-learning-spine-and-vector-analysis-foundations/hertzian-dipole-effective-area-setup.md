---
title: "1.333 Hertzian Dipole Effective Area Setup"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 560", "Page 562", "Section 14.7.2", "Example 14.6", "Figure 14.18"]
related: ["effective-area-and-the-transmit-receive-power-ratio", "antenna-reciprocity-and-identical-transmit-receive-patterns", "receiving-antenna-equivalent-circuit-and-matched-load"]
---

# 1.333 Hertzian Dipole Effective Area Setup

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 560, Page 562, Section 14.7.2, Example 14.6, Figure 14.18

The Hertzian dipole provides a reference antenna for evaluating the universal directivity-to-effective-area ratio. An incident electric field $E_i$ drives the receiving dipole only through its component parallel to the wire. In the coplanar geometry of the source, the projection angle satisfies $\alpha=90^\circ-\theta_2$, so the induced input voltage is $V_{\mathrm{in}}=E_id\cos\alpha=E_id\sin\theta_2$, where $d$ is the dipole length. With a conjugate-matched load, the load current is $I_L=E_id\sin\theta_2/(2R_{22})$. The resulting load power is $P_{L2}=(E_id)^2\sin^2\theta_2/(8R_{22})$. Substituting the Hertzian-dipole radiation resistance $R_{22}=80\pi^2(d/\lambda)^2$ eliminates the physical dipole length and gives $P_{L2}=(1/640)(E_i\lambda\sin\theta_2/\pi)^2$. The incident free-space power density is $S_{r1}=E_i^2/(2\eta_0)=E_i^2/(240\pi)$. These expressions provide the quantities needed to calculate the Hertzian dipole's directional effective area, but the source chunk ends before that final division is shown.

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

- Only the incident electric-field component parallel to the receiving dipole induces voltage.
- The induced voltage is $V_{\mathrm{in}}=E_id\sin\theta_2$.
- With conjugate matching, $I_L=E_id\sin\theta_2/(2R_{22})$.
- Matched-load power is $(E_id)^2\sin^2\theta_2/(8R_{22})$.
- The Hertzian-dipole resistance is $80\pi^2(d/\lambda)^2$.
- Substitution gives $P_{L2}=(1/640)(E_i\lambda\sin\theta_2/\pi)^2$.
- Incident free-space power density is $E_i^2/(240\pi)$.
- The chunk stops before explicitly stating the resulting effective-area formula.

## Source Anchors

- Figure S26.P560.F14.18 shows incident field $E_i$ at angle $\alpha$ to antenna 2 and states $\alpha=90^\circ-\theta_2$.
- Example 14.6, Page 562 gives $V_{\mathrm{in}}=E_id\sin\theta_2$.
- The matched-load current is $I_L=E_id\sin\theta_2/(2R_{22})$.
- Equation (99), Page 562 gives $P_{L2}=(E_id)^2\sin^2\theta_2/(8R_{22})$.
- The Hertzian-dipole radiation resistance is $R_{22}=80\pi^2(d/\lambda)^2$.
- Equation (100), Page 562 gives the simplified received power.
- Equation (101), Page 562 gives $S_{r1}=E_i^2/(240\pi)$ in free space.

## Related Pages

- [[effective-area-and-the-transmit-receive-power-ratio|Effective Area and the Transmit-Receive Power Ratio]]
- [[antenna-reciprocity-and-identical-transmit-receive-patterns|Antenna Reciprocity and Identical Transmit-Receive Patterns]]
- [[receiving-antenna-equivalent-circuit-and-matched-load|Receiving Antenna Equivalent Circuit and Matched Load]]

## Concept Dependencies

- example-of: [[effective-area-and-the-transmit-receive-power-ratio|Effective Area and the Transmit-Receive Power Ratio]]
- depends-on: [[receiving-antenna-equivalent-circuit-and-matched-load|Receiving Antenna Equivalent Circuit and Matched Load]]
