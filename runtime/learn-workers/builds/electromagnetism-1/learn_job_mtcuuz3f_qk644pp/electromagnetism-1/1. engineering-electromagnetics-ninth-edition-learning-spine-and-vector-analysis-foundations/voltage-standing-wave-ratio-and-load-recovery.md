---
title: "1.187 Voltage Standing Wave Ratio and Load Recovery"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 337", "Page 338", "Page 340", "Page 341"]
related: ["standing-wave-decomposition-and-voltage-extrema", "reflection-at-a-load-discontinuity", "finite-lossless-line-input-impedance", "matched-and-mismatched-receiver-line-example"]
---

# 1.187 Voltage Standing Wave Ratio and Load Recovery

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 337, Page 338, Page 340, Page 341

Voltage standing wave ratio is the ratio of the maximum to minimum measured voltage amplitude on a lossless line. Using the extrema created by incident and reflected waves gives
$$
s=\frac{V_{\max}}{V_{\min}}=\frac{1+|\Gamma|}{1-|\Gamma|}
$$
 so $|\Gamma|=(s-1)/(s+1)$. A matched termination has $|\Gamma|=0$ and $s=1$, while a totally reflecting load has $|\Gamma|=1$ and unbounded VSWR. A slotted line measures maxima, minima, their spacing, and their displacement from the load. The spacing gives $\lambda/2$, while the first extremum position determines the reflection phase through the extremum-location equations. Once magnitude and phase of $\Gamma$ are known, $Z_L$ follows from $\Gamma=(Z_L-Z_0)/(Z_L+Z_0)$. Example 10.7 uses $s=5$, $15$ cm maximum spacing, and a first maximum $7.5$ cm from the load to find $\lambda=30$ cm, $f=1$ GHz, $\Gamma=-2/3$, and $Z_L=10\ \Omega$ for $Z_0=50\ \Omega$.

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

#### Page 341

Finally, we introduce the symbol s to denote the VSWR. Voltage standing wave ratio is defined as:
$$
s\equiv\frac{V_{sT}(z_{\text{max}})}{V_{sT}(z_{\text{min}})}=\frac{1+|\Gamma|}{1-|\Gamma|}\quad{(92)}
$$
Since the absolute voltage amplitudes have divided out, our measured VSWR permits the immediate evaluation of $|\Gamma|$. The phase of $\Gamma$ is then found by measuring the location of the first maximum or minimum with respect to the load, and then using (86) or (89) as appropriate. Once $\Gamma$ is known, the load impedance can be found, assuming $Z_{0}$ is known.

D10.3. What voltage standing wave ratio results when $\Gamma=\pm 1/2$?

Ans. 3

#### EXAMPLE 10.7

Slotted line measurements yield a VSWR of 5, a 15-cm spacing between successive voltage maxima, and the first maximum at a distance of 7.5 cm in front of the load. Determine the load impedance, assuming a 50-$\Omega$ impedance for the slotted line.

Solution. The 15-cm spacing between maxima is $\lambda/2$, implying a wavelength of 30 cm. Because the slotted line is air-filled, the frequency is $f=c/\lambda=1$ GHz. The first maximum at 7.5 cm is thus at a distance of $\lambda/4$ from the load, which

[Truncated for analysis]

## Core Ideas

- $s=(1+|\Gamma|)/(1-|\Gamma|)$.
- $|\Gamma|=(s-1)/(s+1)$.
- A matched load gives $s=1$.
- A totally reflecting load gives infinite VSWR.
- Extremum spacing determines wavelength.
- Extremum position relative to the load determines reflection phase.
- Magnitude and phase of $\Gamma$ determine the load impedance.

## Source Anchors

- Equation (92) defines VSWR.
- D10.3 states that $\Gamma=\pm1/2$ gives VSWR $3$.
- Example 10.7 identifies $15$ cm as $\lambda/2$ and obtains $\lambda=30$ cm.
- The air-filled line frequency is calculated as $1$ GHz.
- The first maximum at $\lambda/4$ implies a negative real reflection coefficient.
- The example obtains $\Gamma=-2/3$ and $Z_L=10\ \Omega$.

## Related Pages

- [[standing-wave-decomposition-and-voltage-extrema|Standing-Wave Decomposition and Voltage Extrema]]
- [[reflection-at-a-load-discontinuity|Reflection at a Load Discontinuity]]
- [[finite-lossless-line-input-impedance|Finite Lossless Line Input Impedance]]
- [[matched-and-mismatched-receiver-line-example|Matched and Mismatched Receiver-Line Example]]

## Concept Dependencies

- derives-from: [[standing-wave-decomposition-and-voltage-extrema|Standing-Wave Decomposition and Voltage Extrema]]
- measured-by: [[reflection-at-a-load-discontinuity|Reflection at a Load Discontinuity]]
