---
title: "1.172 Standing Wave from Oppositely Directed Waves"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 326", "Page 327"]
related: ["complex-instantaneous-voltage-and-phasor-voltage", "reflection-at-a-load-discontinuity", "standing-wave-decomposition-and-voltage-extrema", "voltage-standing-wave-ratio-and-load-recovery"]
---

# 1.172 Standing Wave from Oppositely Directed Waves

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 326, Page 327

Two equal-amplitude, equal-frequency waves traveling in opposite directions combine into a standing wave. In phasor form, the sum is $V_{sT}(z)=V_0e^{-j\beta z}+V_0e^{j\beta z}=2V_0\cos(\beta z)$. Restoring the common time factor and taking the real part gives $\mathcal{V}(z,t)=2V_0\cos(\beta z)\cos(\omega t)$. The result separates into a spatial factor and a temporal factor. Every position oscillates at angular frequency $\omega$, but the oscillation amplitude is fixed by $2V_0|\cos(\beta z)|$. Locations where the spatial cosine vanishes are stationary nulls rather than moving crests. The example gives null positions $z_n=m\pi/(2\beta)$ for odd integer $m$. This construction provides the basic interference model later used to understand reflections, voltage maxima and minima, and voltage standing wave ratio.

## Page-Grounded Details

#### Page 326

present example) will usually be used for the voltage or current amplitudes, with the understanding that these will generally be complex (having magnitude and phase).

Two additional definitions follow from Eq. (34). First, we define the complex instantaneous voltage as:
$$
V_{c}(z,t)=V_{0}\,e^{\pm j\beta z}\,e^{j\omega t}\quad{(35)}
$$
The phasor voltage is then formed by dropping the $e^{j\omega t}$ factor from the complex instantaneous form:
$$
V_{s}(z)=V_{0}\,e^{\pm j\beta z}\quad{(36)}
$$
The phasor voltage can be defined provided we have sinusoidal steady-state conditions-meaning that $V_{0}$ is independent of time. This has in fact been our assumption all along, because a time-varying amplitude would imply the existence of other frequency components in our signal. Again, we are treating only a single-frequency wave. The significance of the phasor voltage is that we are effectively letting time stand still and observing the stationary wave in space at $t=0$. The processes of evaluating relative phases between various line positions and of combining multiple waves is made much simpler in phasor form. Again, this works only if all waves under consideration have the sa

[Truncated for analysis]

#### Page 327

In real instantaneous form, this becomes
$$
\mathcal{V}(z,t)=\operatorname{Re}[2\,V_{0}\cos(\beta z)e^{j\omega t}]=2\,V_{0}\cos(\beta z)\cos(\omega t)
$$
We recognize this as a standing wave, in which the amplitude varies, as $\cos(\beta z)$, and oscillates in time, as $\cos(\omega t)$. Zeros in the amplitude (nulls) occur at fixed locations, $z_{n}=(m\pi)/(2\beta)$ where $m$ is an odd integer. We extend the concept in Section 10.10, where we explore the voltage standing wave ratio as a measurement technique.

#### 10.6 TRANSMISSION LINE EQUATIONS AND THEIR SOLUTIONS IN PHASOR FORM

We now apply our results of the previous section to the transmission line equations, beginning with the general wave equation, (11). This is rewritten as follows, for the real instantaneous voltage, $\mathcal{V}(z,t)$:

$\frac{\partial^{2}\mathcal{V}}{\partial z^{2}}=LC\frac{\partial^{2}\mathcal{V}}{\partial t^{2}}+(LG+RC)\frac{\partial\mathcal{V}}{\partial t}+RGV$ (38)

We next substitute $\mathcal{V}(z,t)$ as given by the far right-hand side of (37b), noting that the complex conjugate term (c.c.) will form a separate redundant equation. We also use the fact that the operator $ \parti

[Truncated for analysis]

## Core Ideas

- Opposite traveling-wave phasors add as $e^{-j\beta z}+e^{j\beta z}=2\cos(\beta z)$.
- The real standing wave is $2V_0\cos(\beta z)\cos(\omega t)$.
- The spatial amplitude pattern remains fixed while the voltage oscillates in time.
- Nulls occur where $\cos(\beta z)=0$.
- Equal frequency is required for the phasor addition.
- Standing waves are an interference result, not a separate propagation mode introduced independently.

## Source Anchors

- Example 10.1 combines $V_0e^{-j\beta z}$ and $V_0e^{j\beta z}$.
- The resulting instantaneous voltage is $2V_0\cos(\beta z)\cos(\omega t)$.
- The source identifies nulls at $z_n=m\pi/(2\beta)$ for odd $m$.

## Related Pages

- [[complex-instantaneous-voltage-and-phasor-voltage|Complex Instantaneous Voltage and Phasor Voltage]]
- [[reflection-at-a-load-discontinuity|Reflection at a Load Discontinuity]]
- [[standing-wave-decomposition-and-voltage-extrema|Standing-Wave Decomposition and Voltage Extrema]]
- [[voltage-standing-wave-ratio-and-load-recovery|Voltage Standing Wave Ratio and Load Recovery]]

## Concept Dependencies

- depends-on: [[complex-instantaneous-voltage-and-phasor-voltage|Complex Instantaneous Voltage and Phasor Voltage]]
- enables: [[standing-wave-decomposition-and-voltage-extrema|Standing-Wave Decomposition and Voltage Extrema]]
