---
title: "1.335 Friis Free-Space Transmission Formula"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 563", "Page 567, Problem 14.28", "Pages 567-568, Problem 14.29"]
related: ["antenna-effective-area-and-directivity", "antenna-reciprocity-and-link-reversal", "dipole-radiation-patterns-and-directivity"]
---

# 1.335 Friis Free-Space Transmission Formula

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 563, Page 567, Problem 14.28, Pages 567-568, Problem 14.29

The Friis formula connects total power radiated by a transmitting antenna to power delivered to the matched load of a receiving antenna. In effective-area form, the source gives
$$
\frac{P_{L2}}{P_{r1}}=\frac{A_{e1}(\theta_1,\phi_1)A_{e2}(\theta_2,\phi_2)}{\lambda^2r^2}
$$
 Using $A_e=\lambda^2D/(4\pi)$ yields the equivalent directivity form
$$
\frac{P_{L2}}{P_{r1}}=\frac{\lambda^2}{(4\pi r)^2}D_1(\theta_1,\phi_1)D_2(\theta_2,\phi_2)
$$
 Here $P_{r1}$ is total radiated transmitter power, $P_{L2}$ is power dissipated in the receiving load, $r$ is antenna separation, $\lambda$ is wavelength, and the directional directivities are evaluated along the propagation directions relevant to the link. The $1/r^2$ dependence represents spherical spreading, while the product of antenna properties accounts for directional concentration and reception. The formula assumes lossless antennas, mutual far-zone placement, and a conjugate-matched receiving load. The chapter exercises use it in both forward and reverse links and in links involving half-wave dipoles, rotated antennas, known apertures, and directivities stated in decibels.

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

#### Page 567

$^{14.23}$ A turnstile antenna consists of two crossed dipole antennas, positioned in this case in the xy plane. The dipoles are identical, lie along the x and y axes, and are both fed at the origin. Assume that equal currents are supplied to each antenna and that a zero phase reference is applied to the x-directed antenna. Determine the relative phase, $\xi$, of the y-directed antenna so that the net radiated electric field as measured on the positive z axis is $(a)$ left circularly polarized; $(b)$ linearly polarized along the $45^{\circ}$ axis between x and y.

$^{14.24}$ Consider a linear endfire array, designed for maximum radiation intensity at $\phi=0$, using $\xi$ and $d$ values as suggested in Example 14.5. Determine an expression for the front-to-back ratio (defined in Problem 14.22) as a function of the number of elements $n$ if $n$ is an odd number.

$^{14.25}$ A six-element linear dipole array has element spacing $d=\lambda/2$. $(a)$ Select the appropriate current phasing $\xi$ to achieve maximum radiation along $\phi=\pm\,60^{\circ}$. $(b)$ With the phase set as in part $a$, evaluate the intensities (relative to the maximum) in the

[Truncated for analysis]

#### Page 568

radiates 100 W, how much power is dissipated by a matched load at the receiving antenna? (b) Suppose the receiving antenna is rotated by 45 deg while the two antennas remain in the same plane. What is the received power in this case?

14.30  $\boxed{b}$ A half-wave dipole antenna is known to have a maximum effective area, given as $A_{\max}$. (a) Write the maximum directivity of this antenna in terms of $A_{\max}$ and wavelength $\lambda$. (b) Express the current amplitude, $I_{0}$, needed to radiate total power, $P_{r}$, in terms of $P_{r}$, $A_{\max}$, and $\lambda$. (c) At what values of $\theta$ and $\phi$ will the antenna effective area be equal to $A_{\max}$?

## Core Ideas

- Effective-area form: $P_{L2}/P_{r1}=A_{e1}A_{e2}/(\lambda^2r^2)$.
- Directivity form: $P_{L2}/P_{r1}=\lambda^2D_1D_2/(4\pi r)^2$.
- Received power decreases as $1/r^2$.
- Both antenna factors must be evaluated in the link directions.
- The stated formula assumes lossless antennas in each other's far zones.
- The receiving load must be conjugate-matched to the antenna impedance.

## Source Anchors

- Equation (105) gives both the mixed effective-area/directivity expression and the effective-area product.
- Equation (106) gives the directivity-product form.
- The text explicitly states the assumptions of lossless antennas, far-zone separation, and a conjugate-matched receiving load.
- D14.11 uses a $1\ \mathrm{m^2}$ receiving effective area, $1$ mW load power, $1.0$ km range, and transmitter directivities of 10 dB and 7 dB.
- Problem 14.29 specifies two identical half-wave dipoles, wavelength 1 m, separation 1 km, and transmitter power 100 W.

## Related Pages

- [[antenna-effective-area-and-directivity|Antenna Effective Area and Directivity]]
- [[antenna-reciprocity-and-link-reversal|Antenna Reciprocity and Link Reversal]]
- [[dipole-radiation-patterns-and-directivity|Dipole Radiation Patterns and Directivity]]

## Concept Dependencies

- depends-on: [[antenna-effective-area-and-directivity|Antenna Effective Area and Directivity]]
- enables: [[antenna-reciprocity-and-link-reversal|Antenna Reciprocity and Link Reversal]]
