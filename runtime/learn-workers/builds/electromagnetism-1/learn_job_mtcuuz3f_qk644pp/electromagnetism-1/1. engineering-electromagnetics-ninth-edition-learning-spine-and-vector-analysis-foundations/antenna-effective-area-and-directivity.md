---
title: "1.334 Antenna Effective Area and Directivity"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 563", "Page 568, Problem 14.30"]
related: ["friis-free-space-transmission-formula", "antenna-reciprocity-and-link-reversal", "dipole-radiation-patterns-and-directivity"]
---

# 1.334 Antenna Effective Area and Directivity

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 563, Page 568, Problem 14.30

The effective area of a receiving antenna measures how much power it can deliver to a matched load from an incident power density. For the Hertzian dipole, the source gives $A_{e2}(\theta_2)=\frac{3}{8\pi}\lambda^2\sin^2\theta_2$ and the previously derived directivity $D_2(\theta_2)=\frac{3}{2}\sin^2\theta_2$. Their identical angular dependence reveals the general relation
$$
D(\theta,\phi)=\frac{4\pi}{\lambda^2}A_e(\theta,\phi)
$$
 Thus effective area is not merely a physical aperture size. It is a direction-dependent receiving property directly proportional to transmitting directivity and to the square of wavelength. Solving for area gives $A_e=\lambda^2D/(4\pi)$, so maximum directivity determines maximum effective area. Directivity expressed in decibels must first be converted to a linear ratio before this formula is used. The check problem with $D_{\max}=6$ dB and $\lambda=1$ m gives $D_{\max}\approx4$ and $A_{e,\max}=1/\pi\ \mathrm{m^2}$. This relation also supports reciprocity-based reasoning for antennas used alternately as transmitters and receivers.

## Page-Grounded Details

#### Page 563

Using (100) and (101), the effective area of the Hertzian is
$$
A_{e2}(\theta_{2})=\frac{P_{L2}}{S_{r1}}=\frac{3}{8\pi}\lambda^{2}\,\sin^{2}(\theta_{2})\;\;\;[\,m^{2}\,]
$$
(102)

The directivity for the Hertzian dipole, derived in Example 14.1, is
$$
D_{2}(\theta_{2})=\frac{3}{2}\sin^{2}(\theta_{2})
$$
(103)

Comparing Eqs. (102) and (103), we find the relation that we are looking for: The effective area and directivity for any antenna are related through
$$
D(\theta,\phi)=\frac{4\pi}{\lambda^{2}}A_{e}(\theta,\phi)
$$
(104)

We can now return to Eq. (96) and use Eq. (104) to rewrite the ratio of the power delivered to the receiving antenna load to the total power radiated by the transmitting antenna. This yields an expression that involves the simple product of the effective areas, known as the Friis transmission formula:
$$
\frac{P_{L2}}{P_{r1}}=\frac{A_{e2}(\theta_{2},\phi_{2})D_{1}(\theta_{1},\phi_{1})}{4\pi r^{2}}=\frac{A_{e1}(\theta_{1},\phi_{1})A_{e2}(\theta_{2},\phi_{2})}{\lambda^{2}r^{2}}
$$
(105)

The result can also be expressed in terms of the directivities:
$$ \frac{P_{L2}}{P_{r1}}=\frac{\lambda^{2}}{(4\pi r)^{2}}D_{1}(\theta_{1},\phi_{1})D_{2}(\theta_{2},\phi

[Truncated for analysis]

#### Page 568

radiates 100 W, how much power is dissipated by a matched load at the receiving antenna? (b) Suppose the receiving antenna is rotated by 45 deg while the two antennas remain in the same plane. What is the received power in this case?

14.30  $\boxed{b}$ A half-wave dipole antenna is known to have a maximum effective area, given as $A_{\max}$. (a) Write the maximum directivity of this antenna in terms of $A_{\max}$ and wavelength $\lambda$. (b) Express the current amplitude, $I_{0}$, needed to radiate total power, $P_{r}$, in terms of $P_{r}$, $A_{\max}$, and $\lambda$. (c) At what values of $\theta$ and $\phi$ will the antenna effective area be equal to $A_{\max}$?

## Core Ideas

- Effective area is defined through received load power divided by incident power density.
- For a Hertzian dipole, $A_e(\theta)=\frac{3}{8\pi}\lambda^2\sin^2\theta$.
- For a Hertzian dipole, $D(\theta)=\frac{3}{2}\sin^2\theta$.
- For any antenna in the stated framework, $D(\theta,\phi)=\frac{4\pi}{\lambda^2}A_e(\theta,\phi)$.
- The inverse relation is $A_e(\theta,\phi)=\frac{\lambda^2}{4\pi}D(\theta,\phi)$.
- Directivity in decibels must be converted using $D=10^{D_{\mathrm{dB}}/10}$.

## Source Anchors

- Equation (102): $A_{e2}(\theta_2)=\frac{3}{8\pi}\lambda^2\sin^2(\theta_2)\ [\mathrm{m^2}]$.
- Equation (103): $D_2(\theta_2)=\frac{3}{2}\sin^2(\theta_2)$.
- Equation (104): $D(\theta,\phi)=\frac{4\pi}{\lambda^2}A_e(\theta,\phi)$.
- D14.10 gives $D_{\max}=6$ dB, $\lambda=1$ m, and the answer $A_{e,\max}=1/\pi\ \mathrm{m^2}$.
- Problem 14.30 asks for half-wave-dipole directivity in terms of $A_{\max}$ and $\lambda$ and asks where the effective area reaches its maximum.

## Related Pages

- [[friis-free-space-transmission-formula|Friis Free-Space Transmission Formula]]
- [[antenna-reciprocity-and-link-reversal|Antenna Reciprocity and Link Reversal]]
- [[dipole-radiation-patterns-and-directivity|Dipole Radiation Patterns and Directivity]]

## Concept Dependencies

- enables: [[friis-free-space-transmission-formula|Friis Free-Space Transmission Formula]]
