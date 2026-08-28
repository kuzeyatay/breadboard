---
title: "1.185 Cascaded Line and Junction Loss"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 336", "Page 337"]
related: ["decibel-characterization-of-transmission-loss", "power-reflection-and-load-absorption", "reflection-at-a-load-discontinuity"]
---

# 1.185 Cascaded Line and Junction Loss

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 336, Page 337

A link containing lossy line segments and an impedance-discontinuous junction can be analyzed by converting every contribution to decibels and adding them. A junction with reflection coefficient $\Gamma$ transmits the power fraction $1-|\Gamma|^2$, so its mismatch loss is
$$
L_j=10\log_{10}\left(\frac{1}{1-|\Gamma|^2}\right)
$$
 Example 10.6 combines a $10$ m line rated at $0.20$ dB/m, a junction with $\Gamma=0.30$, and a $15$ m line rated at $0.10$ dB/m. The line losses are $2.0$ dB and $1.5$ dB, while the junction contributes $0.41$ dB, giving $3.91$ dB total. Applying the total loss to a $100$ mW input gives $P_{\text{out}}=100\times10^{-0.391}=41$ mW. This workflow demonstrates why logarithmic loss units are convenient for systems containing both distributed attenuation and localized mismatch.

## Page-Grounded Details

#### Page 336

The reflected power is then found by substituting the reflected wave voltage into $(76a)$, where the latter is obtained by multiplying the incident voltage by $\Gamma$:
$$
\left\langle\mathcal{P}_{r}\right\rangle=\frac{1}{2} \text{Re}\left\{\frac{(\Gamma V_{0})(\Gamma^{*} V_{0}^{*})}{|Z_{0}|} e^{-2\alpha L} e^{j\theta}\right\}=\frac{1}{2}\frac{|\Gamma|^{2}|V_{0}|^{2}}{|Z_{0}|} e^{-2\alpha L} \cos\theta
$$
(76b)

The reflected power fraction at the load is now determined by the ratio of (76b) to (76a):
$$
\frac{\left\langle\mathcal{P}_{r}\right\rangle}{\left\langle\mathcal{P}_{i}\right\rangle}=\Gamma\Gamma^{*}=|\Gamma|^{2}
$$
(77a)

The fraction of the incident power that is transmitted into the load (or dissipated by it) is therefore
$$
\frac{\left\langle\mathcal{P}_{i}\right\rangle}{\left\langle\mathcal{P}_{i}\right\rangle}=1-|\Gamma|^{2}
$$
(77b)

The reader should be aware that the transmitted power fraction is not $|\tau|^{2}$, as one might be tempted to conclude.

In situations involving the connection of two semi-infinite transmission lines having different characteristic impedances, reflections will occur at the junction, with the second line being treated as the load.

[Truncated for analysis]

#### Page 337

power (to line 1) is 100 mW. (a) Determine the total loss of the combination in dB. (b) Determine the power transmitted to the output end of line 2.

Solution. (a) The dB loss of the joint is
$$
L_{j}(\mathrm{dB})=10\log_{10}\left(\frac{1}{1-|\Gamma|^{2}}\right)=10\log_{10}\left(\frac{1}{1-0.09}\right)=0.41\,\mathrm{dB}
$$
The total loss of the link in dB is now
$$
L_{t}(\mathrm{dB})=(0.20)(10)+0.41+(0.10)(15)=3.91\,\mathrm{dB}
$$
(b) The output power will be $P_{\mathrm{out}}=100\times 10^{-0.391}=41$ mW.

#### 10.10 VOLTAGE STANDING WAVE RATIO

In many instances, characteristics of transmission line performance are amenable to measurement. Included in these are measurements of unknown load impedances, or input impedances of lines that are terminated by known or unknown load impedances. Such techniques rely on the ability to measure voltage amplitudes that occur as functions of position within a line, usually designed for this purpose. A typical apparatus consists of a slotted line, which is a lossless coaxial transmission line having a longitudinal gap in the outer conductor along its entire length. The line is positioned between the sinusoidal voltage source and the impeda

[Truncated for analysis]

## Core Ideas

- Junction transmission fraction is $1-|\Gamma|^2$.
- Junction loss is $10\log_{10}[1/(1-|\Gamma|^2)]$.
- Distributed line loss is rating times length.
- All component losses add in decibels.
- Convert total dB loss back to power with $P_{\text{out}}=P_{\text{in}}10^{-L_{\mathrm{dB}}/10}$.

## Source Anchors

- Example 10.6 uses line losses of $0.20$ dB/m over $10$ m and $0.10$ dB/m over $15$ m.
- The junction coefficient $\Gamma=0.30$ produces $0.41$ dB loss.
- The total calculated loss is $3.91$ dB.
- A $100$ mW input produces a $41$ mW output.

## Related Pages

- [[decibel-characterization-of-transmission-loss|Decibel Characterization of Transmission Loss]]
- [[power-reflection-and-load-absorption|Power Reflection and Load Absorption]]
- [[reflection-at-a-load-discontinuity|Reflection at a Load Discontinuity]]

## Concept Dependencies

- depends-on: [[power-reflection-and-load-absorption|Power Reflection and Load Absorption]]
- applies-to: [[decibel-characterization-of-transmission-loss|Decibel Characterization of Transmission Loss]]
