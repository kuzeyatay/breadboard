---
title: "1.167 Characteristic Impedance and Wave Current Direction"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 322", "Page 323", "Section 10.3: Lossless Propagation"]
related: ["telegraphists-equations", "lossless-traveling-wave-solutions", "physical-wavefront-propagation-on-a-transmission-line", "sinusoidal-phase-propagation-and-wavelength"]
---

# 1.167 Characteristic Impedance and Wave Current Direction

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 322, Page 323, Section 10.3: Lossless Propagation

Under lossless conditions, the telegraphist's equations reduce to $\partial V/\partial z=-L\,\partial I/\partial t$ and $\partial I/\partial z=-C\,\partial V/\partial t$. Substituting the forward and backward voltage waves and integrating in time gives
$$
I(z,t)=\frac{1}{Lv}\left[f_1\left(t-\frac{z}{v}\right)-f_2\left(t+\frac{z}{v}\right)\right]
$$
 The factor that converts a single-wave current to voltage is the characteristic impedance:
$$
Z_0=Lv=\sqrt{\frac{L}{C}}
$$
 Therefore, $V^+=Z_0I^+$ for a forward wave, while $V^-=-Z_0I^-$ for a backward wave. The negative sign does not imply negative voltage. It records the current-reference convention: forward and backward waves with the same positive voltage polarity carry currents in opposite physical directions.

## Page-Grounded Details

#### Page 322

where $f_{1}^{\prime\prime}$ is the second derivative of $f_{1}$ with respect to its argument. The results in (17) can now be substituted into (13), obtaining
$$
\frac{1}{v^{2}}f_{1}^{\prime\prime}=LCf_{1}^{\prime\prime}\quad{(18)}
$$
We now identify the wave velocity for lossless propagation, which is the condition for equality in (18):
$$
v=\frac{1}{\sqrt{LC}}\quad{(19)}
$$
Performing the same procedure using $f_{2}$ (and its argument) leads to the same expression for $v$.

The form of $v$ as expressed in Eq. (19) confirms our original expectation that the wave velocity would be in some inverse proportion to $L$ and $C$. The same result will be true for current, as Eq. (12) under lossless conditions would lead to a solution of the form identical to that of (14), with velocity given by (19). What is not known yet, however, is the relation between voltage and current.

We have already found that voltage and current are related through the telegraph's equations, (5) and (8). These, under lossless conditions ($R=G=0$), become
$$
\frac{\partial V}{\partial z}=-L\frac{\partial I}{\partial t}\quad{(20)}
$$
$$
\frac{\partial I}{\partial z}=-C\frac{\partial V}{\parti

[Truncated for analysis]

#### Page 323

Figure 10.4 Current directions in waves having positive voltage polarity.

to the current in a single propagating wave. Using (19), we write the characteristic impedance as
$$
 Z_{0}=Lv=\sqrt{\frac{L}{C}}\quad{(24)}
$$
By inspecting (14) and (23), we now note that
$$
 V^{+}=Z_{0}I^{+}\quad{(25a)}
$$
and
$$
 V^{-}=-Z_{0}I^{-}\quad{(25b)} $$
The significance of the preceding relations can be seen in Figure 10.4. The figure shows forward- and backward-propagating voltage waves, $V^{+}$ and $V^{-}$, both of which have positive polarity. The currents that are associated with these voltages will flow in opposite directions. We define positive current as having a clockwise flow in the line, and negative current as having a counterclockwise flow. The minus sign in (25b) thus assures that negative current will be associated with a backward-propagating wave that has positive polarity. This is a general convention, applying to lines with losses also. Propagation with losses is studied by solving (11) under the assumption that either R or G (or both) are not zero. We will do this in Section 10.7 under the special case of sinusoidal voltages and currents. Sinusoids in lossless transmissi

[Truncated for analysis]

## Core Ideas

- Lossless voltage and current remain coupled by the first-order line equations.
- Forward-wave voltage and current satisfy $V^+=Z_0I^+$.
- Backward-wave voltage and current satisfy $V^-=-Z_0I^-$.
- Characteristic impedance is $Z_0=\sqrt{L/C}$.
- The backward-wave minus sign follows from the chosen positive-current direction.

## Source Anchors

- Equations (20) and (21) on Page 322 are the lossless telegraphist's equations.
- Equations (22) and (23) derive current from the voltage traveling-wave functions.
- Equation (24) on Page 323 defines $Z_0=Lv=\sqrt{L/C}$.
- Equations (25a) and (25b) relate voltage and current for each propagation direction.
- Figure 10.4 on Page 323 shows current directions for forward and backward waves with positive voltage polarity.

## Related Pages

- [[telegraphists-equations|Telegraphist's Equations]]
- [[lossless-traveling-wave-solutions|Lossless Traveling-Wave Solutions]]
- [[physical-wavefront-propagation-on-a-transmission-line|Physical Wavefront Propagation on a Transmission Line]]
- [[sinusoidal-phase-propagation-and-wavelength|Sinusoidal Phase Propagation and Wavelength]]

## Concept Dependencies

- depends-on: [[lossless-traveling-wave-solutions|Lossless Traveling-Wave Solutions]]
- depends-on: [[telegraphists-equations|Telegraphist's Equations]]
- applies-to: [[physical-wavefront-propagation-on-a-transmission-line|Physical Wavefront Propagation on a Transmission Line]]
