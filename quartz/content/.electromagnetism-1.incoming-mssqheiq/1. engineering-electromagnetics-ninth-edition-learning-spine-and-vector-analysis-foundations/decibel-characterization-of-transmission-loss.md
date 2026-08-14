---
title: "1.182 Decibel Characterization of Transmission Loss"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 333", "Page 334"]
related: ["average-power-in-a-lossy-transmission-line", "low-loss-expansion-of-the-propagation-constant", "power-reflection-and-load-absorption", "cascaded-line-and-junction-loss"]
---

# 1.182 Decibel Characterization of Transmission Loss

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 333, Page 334

Since average power varies as $\langle\mathcal{P}(z)\rangle=\langle\mathcal{P}(0)\rangle e^{-2\alpha z}$, attenuation can be expressed as a logarithmic power loss. The conversion between nepers and decibels gives
$$
L_{\mathrm{dB}}=10\log_{10}\left(\frac{\langle\mathcal{P}(0)\rangle}{\langle\mathcal{P}(z)\rangle}\right)=8.69\alpha z
$$
 Because power is proportional to squared voltage amplitude, the equivalent voltage form is $L_{\mathrm{dB}}=20\log_{10}(|V_0(0)|/|V_0(z)|)$. Example 10.4 shows that a $2.0$ dB loss leaves a power fraction $10^{-0.2}=0.63$, while half the distance produces a $1.0$ dB loss and leaves $0.79$. The corresponding attenuation coefficient is $0.012$ Np/m for a $20$ m line. Decibels are especially useful because losses of cascaded lines, joints, and devices add directly rather than requiring repeated multiplication of power ratios.

## Page-Grounded Details

#### Page 333

An important result of the preceding exercise is that power attenuates as $e^{-2\alpha z}$, or
$$
\langle\mathcal{P}(z)\rangle=\langle\mathcal{P}(0)\rangle e^{-2\alpha z}\quad{(65)}
$$
Power drops at twice the exponential rate with distance as either voltage or current.

A convenient measure of power loss is in decibel units. This is based on expressing the power decrease as a power of 10. Specifically, we write
$$
\frac{\langle\mathcal{P}(z)\rangle}{\langle\mathcal{P}(0)\rangle}=e^{-2\alpha z}=10^{-\kappa\alpha z}\quad{(66)}
$$
where the constant, $\kappa$, is to be determined. Setting $\alpha z=1$, we find
$$
e^{-2}=10^{-\kappa}\Rightarrow\kappa=\log_{10}(e^{2})=0.869\quad{(67)}
$$
Now, by definition, the power loss in decibels (dB) is
$$
\text{Power loss(dB)}=10\log_{10}\left[\frac{\langle\mathcal{P}(0)\rangle}{\langle\mathcal{P}(z)\rangle}\right]=8.69\alpha z\quad{(68)}
$$
where we note that inverting the power ratio in the argument of the log function [as compared to the ratio in (66)] yields a positive number for the dB loss. Also, noting that $\langle\mathcal{P}\rangle\propto|V_{0}|^{2}$, we may write, equivalently:
$$ \text{Power loss(dB)}=10\log_{10}\left[

[Truncated for analysis]

#### Page 334

are all end-to-end connected, the net loss in dB for the entire span is just the sum of the dB losses of the individual elements.

D10.2. Two transmission lines are to be joined end to end. Line 1 is 30 m long and is rated at 0.1 dB/m. Line 2 is 45 m long and is rated at 0.15 dB/m. The joint is not done well and imparts a 3-dB loss. What percentage of the input power reaches the output of the combination?

Ans. 5.3%

#### 10.9 WAVE REFLECTION AT DISCONTINUITIES

The concept of wave reflection was introduced in Section 10.1. As implied there, the need for a reflected wave originates from the necessity to satisfy all voltage and current boundary conditions at the ends of transmission lines and at locations at which two dissimilar lines are connected to each other. The consequences of reflected waves are usually less than desirable, in that some of the power that was intended to be transmitted to a load, for example, reflects and propagates back to the source. Conditions for achieving no reflected waves are therefore important to understand.

The basic reflection problem is illustrated in Figure 10.5. In it, a transmission line of characteristic impedance $Z_{0}$ is terminated by a

[Truncated for analysis]

## Core Ideas

- $\langle\mathcal{P}(z)\rangle/\langle\mathcal{P}(0)\rangle=e^{-2\alpha z}$.
- $L_{\mathrm{dB}}=8.69\alpha z$ when $\alpha$ is in Np per unit distance.
- Power ratios use $10\log_{10}$.
- Voltage amplitude ratios use $20\log_{10}$.
- A positive loss uses input power divided by output power.
- Cascaded dB losses add directly.

## Source Anchors

- Equations (65) through (69) derive exponential and decibel loss relations.
- Example 10.4 finds an output fraction of $0.63$ after a $2.0$ dB loss.
- Example 10.4 finds a midpoint fraction of $0.79$ and $\alpha=0.012\ \text{Np/m}$.
- D10.2 combines two line losses and a $3$ dB joint loss, giving $5.3\%$ output power.

## Related Pages

- [[average-power-in-a-lossy-transmission-line|Average Power in a Lossy Transmission Line]]
- [[low-loss-expansion-of-the-propagation-constant|Low-Loss Expansion of the Propagation Constant]]
- [[power-reflection-and-load-absorption|Power Reflection and Load Absorption]]
- [[cascaded-line-and-junction-loss|Cascaded Line and Junction Loss]]

## Concept Dependencies

- derives-from: [[average-power-in-a-lossy-transmission-line|Average Power in a Lossy Transmission Line]]
