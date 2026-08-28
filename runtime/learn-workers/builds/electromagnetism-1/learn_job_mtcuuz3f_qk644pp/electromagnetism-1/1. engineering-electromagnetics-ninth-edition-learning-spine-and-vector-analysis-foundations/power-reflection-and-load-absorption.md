---
title: "1.184 Power Reflection and Load Absorption"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 335", "Page 336"]
related: ["reflection-at-a-load-discontinuity", "average-power-in-a-lossy-transmission-line", "decibel-characterization-of-transmission-loss", "cascaded-line-and-junction-loss"]
---

# 1.184 Power Reflection and Load Absorption

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 335, Page 336

The magnitude of the voltage reflection coefficient determines the reflected fraction of incident average power. Since reflected voltage amplitude is $\Gamma$ times incident voltage amplitude, the reflected power contains the product $\Gamma\Gamma^*=|\Gamma|^2$. Thus
$$
\frac{\langle\mathcal{P}_r\rangle}{\langle\mathcal{P}_i\rangle}=|\Gamma|^2
$$
 and the fraction accepted or dissipated by the load is $1-|\Gamma|^2$. This accepted-power fraction is not $|\tau|^2$, because the voltage transmission coefficient alone does not account for the associated load current. For two joined semi-infinite lines, the second line acts as the load, giving $\Gamma=(Z_{02}-Z_{01})/(Z_{02}+Z_{01})$. Example 10.5 uses $Z_0=50\ \Omega$ and $Z_L=50-j75\ \Omega$ to find $|\Gamma|=0.60$, so a $100$ mW incident wave delivers $64$ mW to the load. This procedure separates voltage reflection from power delivery.

## Page-Grounded Details

#### Page 335

The phasor voltage at the load is now the sum of the incident and reflected voltage phasors, evaluated at $z=0$ :
$$
V_{L}=V_{0i}+V_{0r}\quad{(71)}
$$
Additionally, the current through the load is the sum of the incident and reflected currents, also at $z=0$ :
$$
I_{L}=I_{0i}+I_{0r}=\frac{1}{Z_{0}}\left[V_{0i}-V_{0r}\right]=\frac{V_{L}}{Z_{L}}=\frac{1}{Z_{L}}\left[V_{0i}+V_{0r}\right]\quad{(72)}
$$
We can now solve for the ratio of the reflected voltage amplitude to the incident voltage amplitude, defined as the reflection coefficient, $\Gamma$ :
$$
\Gamma\equiv\frac{V_{0r}}{V_{0i}}=\frac{Z_{L}-Z_{0}}{Z_{L}+Z_{0}}=|\Gamma|e^{j\phi_{r}}\quad{(73)}
$$
where we emphasize the complex nature of $\Gamma$ - meaning that, in general, a reflected wave will experience a reduction in amplitude and a phase shift, relative to the incident wave.

Now, using (71) with (73), we may write
$$
V_{L}=V_{0i}+\Gamma\,V_{0i}\quad{(74)}
$$
from which we find the transmission coefficient, defined as the ratio of the load voltage amplitude to the incident voltage amplitude:
$$
\tau\equiv\frac{V_{L}}{V_{0i}}=1+\Gamma=\frac{2Z_{L}}{Z_{0}+Z_{L}}=|\tau|e^{j\phi_{i}}\quad{(75)}
$$
A point that

[Truncated for analysis]

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

## Core Ideas

- Reflected power fraction is $|\Gamma|^2$.
- Accepted load-power fraction is $1-|\Gamma|^2$.
- The transmitted power fraction is not generally $|\tau|^2$.
- A matched load accepts all incident power in the stated line model.
- For two lines, treat the second characteristic impedance as the terminating load.
- Power calculations use the magnitude of the complex reflection coefficient.

## Source Anchors

- Equations (76a) and (76b) give incident and reflected average powers.
- Equation (77a) gives the reflected fraction $|\Gamma|^2$.
- Equation (77b) gives the accepted fraction $1-|\Gamma|^2$.
- Equation (78) gives the reflection coefficient between two semi-infinite lines.
- Example 10.5 obtains $\Gamma=0.36-j0.48=0.60e^{-j0.93}$ and $64$ mW delivered power.

## Related Pages

- [[reflection-at-a-load-discontinuity|Reflection at a Load Discontinuity]]
- [[average-power-in-a-lossy-transmission-line|Average Power in a Lossy Transmission Line]]
- [[decibel-characterization-of-transmission-loss|Decibel Characterization of Transmission Loss]]
- [[cascaded-line-and-junction-loss|Cascaded Line and Junction Loss]]

## Concept Dependencies

- derives-from: [[reflection-at-a-load-discontinuity|Reflection at a Load Discontinuity]]
- depends-on: [[average-power-in-a-lossy-transmission-line|Average Power in a Lossy Transmission Line]]
