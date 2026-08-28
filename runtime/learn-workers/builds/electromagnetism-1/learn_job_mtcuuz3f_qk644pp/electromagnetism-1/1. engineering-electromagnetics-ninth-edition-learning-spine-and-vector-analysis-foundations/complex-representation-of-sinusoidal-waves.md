---
title: "1.170 Complex Representation of Sinusoidal Waves"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 325", "Page 326"]
related: ["constant-phase-criterion-for-wave-direction", "complex-instantaneous-voltage-and-phasor-voltage", "standing-wave-from-oppositely-directed-waves"]
---

# 1.170 Complex Representation of Sinusoidal Waves

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 325, Page 326

Euler's identity converts sinusoidal functions into complex exponentials, making accumulated phase and the combination of same-frequency waves easier to analyze. The identity $e^{\pm jx}=\cos x\pm j\sin x$ implies that cosine is the real part and sine is the appropriately signed imaginary part of a complex exponential. It also gives exponential decompositions such as $\cos x=\tfrac12(e^{jx}+e^{-jx})$. The symbol $j=\sqrt{-1}$ is used, and the complex conjugate is formed by reversing the sign of every occurrence of $j$. A real voltage wave $|V_0|\cos(\omega t\pm\beta z+\phi)$ can therefore be represented using a complex amplitude $V_0=|V_0|e^{j\phi}$. This complex amplitude stores magnitude and initial phase in one quantity. The real physical wave is recovered only after the complex expression has been multiplied by any required time factor and its real part has been taken.

## Page-Grounded Details

#### Page 325

We next consider a point (such as a wave crest) on the cosine function of Eq. (27a), the occurrence of which requires the argument of the cosine to be an integer multiple of $2\pi$. Considering the $m$th crest of the wave, the condition at $t=0$ becomes
$$
\beta z=2m\pi
$$
To keep track of this point on the wave, we require that the entire cosine argument be the same multiple of $2\pi$ for all time. From (27a) the condition becomes
$$
\omega t-\beta z=\omega(t-z/v_{p})=2m\pi\quad{(31)}
$$
Again, with increasing time, the position $z$ must also increase in order to satisfy (31). Consequently the wave crest (and the entire wave) travels in the positive $z$ direction at velocity $v_{p}$. Eq. (27b), having cosine argument $(\omega t+\beta z)$, describes a wave that travels in the negative $z$ direction, since as time increases, $z$ must now decrease to keep the argument constant. Similar behavior is found for the wave current, but complications arise from line-dependent phase differences that occur between current and voltage. These issues are best addressed once we are familiar with complex analysis of sinusoidal signals.

#### 10.5 COMPLEX ANALYSIS OF SINUSOID

[Truncated for analysis]

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

## Core Ideas

- Euler's identity is $e^{\pm jx}=\cos x\pm j\sin x$.
- Cosine can be written as $\cos x=\tfrac12(e^{jx}+e^{-jx})$.
- The notation c.c. denotes the complex conjugate of the preceding term.
- The complex amplitude is $V_0=|V_0|e^{j\phi}$.
- Magnitude and phase are encoded together in a complex amplitude.
- The physical sinusoid is obtained by taking the real part.

## Source Anchors

- Equation (32) states the Euler identity.
- Equations (33a) and (33b) express cosine and sine using complex exponentials.
- Equation (34) applies the complex representation to $|V_0|\cos(\omega t\pm\beta z+\phi)$.
- The source defines the conjugate by changing the sign of $j$ wherever it appears.

## Related Pages

- [[constant-phase-criterion-for-wave-direction|Constant-Phase Criterion for Wave Direction]]
- [[complex-instantaneous-voltage-and-phasor-voltage|Complex Instantaneous Voltage and Phasor Voltage]]
- [[standing-wave-from-oppositely-directed-waves|Standing Wave from Oppositely Directed Waves]]

