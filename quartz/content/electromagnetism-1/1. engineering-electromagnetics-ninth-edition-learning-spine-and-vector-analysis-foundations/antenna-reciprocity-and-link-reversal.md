---
title: "1.342 Antenna Reciprocity and Link Reversal"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 563", "Page 567, Problem 14.28"]
related: ["friis-free-space-transmission-formula", "antenna-effective-area-and-directivity"]
---

# 1.342 Antenna Reciprocity and Link Reversal

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 563, Page 567, Problem 14.28

The link-reversal problem demonstrates a practical consequence of reciprocal propagation and reciprocal antenna behavior. A ground transmitter radiates 10 kW while a mobile receiving station dissipates 1 mW in its matched load. Without moving the receiver, the roles are reversed and the mobile station radiates 100 W. Because the same path and antenna orientations are retained, the fractional transmission factor between radiated power at one terminal and matched-load power at the other is the same in either direction. The original link therefore establishes a transfer ratio that can be applied directly to the reversed link. This reasoning is also consistent with the symmetric product in the Friis formula, where the two antennas enter through $A_{e1}A_{e2}$ or $D_1D_2$. The method is reusable when neither range nor individual antenna properties need to be recomputed: infer the path gain from one direction, then multiply it by the radiated power in the reverse direction. The assumptions remain those of the underlying link relation, including unchanged geometry, orientation, frequency, propagation environment, and matched receiving loads.

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

## Core Ideas

- The same stationary link is used in both transmission directions.
- The forward link determines the end-to-end power-transfer ratio.
- The reciprocal link uses the same transfer ratio when geometry and frequency are unchanged.
- The Friis antenna product is symmetric under interchange of transmitter and receiver.
- Matched-load received power is distinguished from total intercepted or available power.
- No separate recomputation of distance or antenna factors is needed when the link is unchanged.

## Source Anchors

- Problem 14.28 gives 10 kW radiated by the ground station and 1 mW dissipated at the mobile matched load.
- The mobile receiver is explicitly stated not to have moved before transmitting back.
- The mobile station radiates 100 W in the reverse direction.
- Equation (105) contains the symmetric product $A_{e1}A_{e2}$.
- Equation (106) contains the symmetric product $D_1D_2$.

## Related Pages

- [[friis-free-space-transmission-formula|Friis Free-Space Transmission Formula]]
- [[antenna-effective-area-and-directivity|Antenna Effective Area and Directivity]]

## Concept Dependencies

- derives-from: [[friis-free-space-transmission-formula|Friis Free-Space Transmission Formula]]
