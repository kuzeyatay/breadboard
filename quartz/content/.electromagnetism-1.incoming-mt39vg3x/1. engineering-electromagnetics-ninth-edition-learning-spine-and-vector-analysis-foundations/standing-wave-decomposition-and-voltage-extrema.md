---
title: "1.186 Standing-Wave Decomposition and Voltage Extrema"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 337", "Page 338", "Page 339", "Page 340"]
related: ["standing-wave-from-oppositely-directed-waves", "reflection-at-a-load-discontinuity", "voltage-standing-wave-ratio-and-load-recovery", "finite-lossless-line-input-impedance"]
---

# 1.186 Standing-Wave Decomposition and Voltage Extrema

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 337, Page 338, Page 339, Page 340

On a lossless line terminated at $z=0$, the total voltage is the sum of incident and reflected phasors: $V_{sT}(z)=V_0e^{-j\beta z}+\Gamma V_0e^{j\beta z}$, where $\Gamma=|\Gamma|e^{j\phi}$. Algebraic rearrangement separates the real voltage into a traveling component of amplitude $(1-|\Gamma|)V_0$ and a standing component of amplitude $2|\Gamma|V_0$. The extrema are more directly found by comparing the phases of the two phasor terms. Destructive alignment gives
$$
z_{\min}=-\frac{\phi+(2m+1)\pi}{2\beta},\qquad V_{\min}=V_0(1-|\Gamma|)
$$
 while constructive alignment gives
$$
z_{\max}=-\frac{\phi+2m\pi}{2\beta},\qquad V_{\max}=V_0(1+|\Gamma|)
$$
 Adjacent minima and adjacent maxima are separated by $\lambda/2$. Figures 10.6 and the slotted-line discussion connect the reflection-coefficient phase to the displacement of the extrema relative to the load.

## Page-Grounded Details

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

#### Page 338

For example, if the load is a short circuit, the requirement of zero voltage at the short leads to a null occurring there, and so the voltage in the line will vary as $|\sin(\beta z)|$ (where $\phi=\pm\pi/2$).

A more complicated situation arises when the reflected voltage is neither 0 nor 100 percent of the incident voltage. Some energy is absorbed by the load and some is reflected. The slotted line, therefore, supports a voltage that is composed of both a traveling wave and a standing wave. It is customary to describe this voltage as a standing wave, even though a traveling wave is also present. We will see that the volt-age does not have zero amplitude at any point for all time, and the degree to which the voltage is divided between a traveling wave and a true standing wave is expressed by the ratio of the maximum amplitude found by the probe to the minimum ampli-tude (VSWR). This information, along with the positions of the voltage minima or maxima with respect to that of the load, enable one to determine the load impedance. The VSWR also provides a measure of the quality of the termination. Specifically, a perfectly matched load yields a VSWR of exactly 1. A totally reflec

[Truncated for analysis]

#### Page 339

The important characteristics of this result are most easily seen by converting it to real instantaneous form:
$$
\mathcal{V}(z, t)=\mathrm{Re}\left[ V_{sT}(z) e^{j \omega t}\right]=\underbrace{V_{0}(1-|\Gamma|) \cos(\omega t-\beta z)}_{\text {traveling wave}}+\underbrace{2|\Gamma| V_{0} \cos(\beta z+\phi /2) \cos(\omega t+\phi /2)}_{\text {standing wave}}\quad{(84)}
$$
Equation (84) is recognized as the sum of a traveling wave of amplitude $(1-|\Gamma|)\,V_0$ and a standing wave having amplitude $2|\Gamma|V_0$. We can visualize events as follows: The portion of the incident wave that reflects and back-propagates in the slotted line interferes with an equivalent portion of the incident wave to form a standing wave. The rest of the incident wave (which does not interfere) is the traveling wave part of (84). The maximum amplitude observed in the line is found where the amplitudes of the two terms in (84) add directly to give $(1+|\Gamma|)\,V_0$. The minimum amplitude is found where the standing wave achieves a null, leaving only the traveling wave amplitude of $(1-|\Gamma|)V_0$. The fact that the two terms in (84) combine in this way with the proper phasing is not immediately appar

[Truncated for analysis]

#### Page 340

On substituting (89) into (85), we obtain
$$
V_{sT}(z_{\max})=V_{0}(1+|\Gamma|)\quad{(90)}
$$
As before, we may substitute (89) into the real instantaneous voltage (84). The effect is to produce a maximum in the standing wave part, which then adds in-phase to the running wave. The result is
$$
\mathcal{V}(z_{\max},t)=\pm V_{0}(1+|\Gamma|)\cos(\omega t+\phi/2)\quad{(91)}
$$
where the plus and minus signs apply to positive and negative values of $m$ in (89), respectively. Again, the voltage oscillates through zero in time, with amplitude $V_{0}(1+|\Gamma|)$.

Note that a voltage maximum is located at the load ($z=0$) if $\phi=0$; moreover, $\phi=0$ when $\Gamma$ is real and positive. This occurs for real $Z_{L}$ when $Z_{L}>Z_{0}$. Thus there is a voltage maximum at the load when the load impedance is greater than $Z_{0}$ and both impedances are real. With $\phi=0$, maxima also occur at $z_{\max}=-m\pi/\beta=-m\lambda/2$. For a zero-load impedance, $\phi=\pi$, and the maxima are found at $z_{\max}=-\pi/(2\beta)$, $-3\pi/(2\beta)$, or $z_{\max}=-\lambda/4$, $-3\lambda/4$, and so forth.

The minima are separated by multiples of one half-wavelength (a

[Truncated for analysis]

## Core Ideas

- The total line voltage is the sum of incident and reflected phasors.
- The traveling-wave amplitude is $(1-|\Gamma|)V_0$.
- The standing-wave amplitude is $2|\Gamma|V_0$.
- $V_{\min}=V_0(1-|\Gamma|)$.
- $V_{\max}=V_0(1+|\Gamma|)$.
- Successive minima or maxima are separated by $\lambda/2$.
- The phase $\phi$ determines extremum locations relative to the load.

## Source Anchors

- Equations (79) through (83) transform the incident-reflected sum.
- Equation (84) explicitly labels traveling-wave and standing-wave components.
- Equations (86) and (89) give minimum and maximum locations.
- Equations (87) and (90) give minimum and maximum amplitudes.
- Figure 10.6 plots $|V_{sT}|$ and identifies extrema determined by $\phi$.
- The short-circuit case has a voltage null at the load and varies as $|\sin(\beta z)|$.

## Related Pages

- [[standing-wave-from-oppositely-directed-waves|Standing Wave from Oppositely Directed Waves]]
- [[reflection-at-a-load-discontinuity|Reflection at a Load Discontinuity]]
- [[voltage-standing-wave-ratio-and-load-recovery|Voltage Standing Wave Ratio and Load Recovery]]
- [[finite-lossless-line-input-impedance|Finite Lossless Line Input Impedance]]

## Concept Dependencies

- derives-from: [[reflection-at-a-load-discontinuity|Reflection at a Load Discontinuity]]
- applies-to: [[standing-wave-from-oppositely-directed-waves|Standing Wave from Oppositely Directed Waves]]
