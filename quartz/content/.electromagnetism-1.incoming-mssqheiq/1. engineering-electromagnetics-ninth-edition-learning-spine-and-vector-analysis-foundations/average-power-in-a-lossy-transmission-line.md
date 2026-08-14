---
title: "1.181 Average Power in a Lossy Transmission Line"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 331", "Page 332", "Page 333"]
related: ["attenuation-and-phase-in-a-lossy-line", "characteristic-impedance-of-a-transmission-line", "decibel-characterization-of-transmission-loss", "power-reflection-and-load-absorption"]
---

# 1.181 Average Power in a Lossy Transmission Line

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 331, Page 332, Page 333

Instantaneous power is the product of the real voltage and current. For a forward wave, both amplitudes decay as $e^{-\alpha z}$, so their product contains $e^{-2\alpha z}$. If voltage and current differ in phase by $\theta$, averaging their cosine product over one period removes the double-frequency term and retains the constant term proportional to $\cos\theta$. The result is
$$
\langle\mathcal{P}\rangle=\frac12|V_0||I_0|e^{-2\alpha z}\cos\theta=\frac12\frac{|V_0|^2}{|Z_0|}e^{-2\alpha z}\cos\theta
$$
 The same result follows directly from phasors using $\langle\mathcal{P}\rangle=\tfrac12\operatorname{Re}\{V_sI_s^*\}$. Conjugating the current phasor cancels the common spatial phase while preserving the voltage-current phase difference. This formula applies to any single-frequency wave and shows that power decays at twice the exponential rate of voltage or current amplitude.

## Page-Grounded Details

#### Page 331

quantify. We will study this in Chapter 11, and we will apply it to transmission line structures in Chapter 13.

Finally, we can apply the low-loss approximation to the characteristic impedance, Eq. (47). Using (51), we find
$$
Z_{0} = \sqrt{\frac{R + j\omega L}{G + j\omega C}} = \sqrt{\frac{j\omega L\left(1 + \frac{R}{j\omega L}\right)}{j\omega C\left(1 + \frac{G}{j\omega C}\right)}} \doteq \sqrt{\frac{L}{C}}\left[ \frac{\left(1 + \frac{R}{j2\omega L} + \frac{R^2}{8\omega^2 L^2}\right)}{\left(1 + \frac{G}{j2\omega C} + \frac{G^2}{8\omega^2 C^2}\right)} \right] \quad{(55)}
$$
 Next, we multiply (55) by a factor of 1, in the form of the complex conjugate of the denominator of (55) divided by itself. The resulting expression is simplified by neglecting all terms on the order of $R^{2}G$, $G^{2}R$, and higher. Additionally, the approximation, $1/(1+x)\doteq 1-x$, where $x\ll 1$ is used. The result is
$$
Z_{0} \doteq \sqrt{\frac{L}{C}}\left\{ 1 + \frac{1}{2\omega^{2}}\left[ \frac{1}{4}\left( \frac{R}{L} + \frac{G}{C} \right)^{2} - \frac{G^{2}}{C^{2}} \right] + \frac{j}{2\omega}\left( \frac{G}{C} - \frac{R}{L} \right) \right\} \quad{(56)}
$$
 Note that when Heaviside's condi

[Truncated for analysis]

#### Page 332

where again, the amplitude, $V_{0}^{+} = |V_{0}|$, is taken to be real. The current waveform will be similar, but will generally be shifted in phase. Both current and voltage attenuate according to the factor $e^{-\alpha z}$. The instantaneous power therefore becomes:
$$
\mathcal{P}(z,t)=\mathcal{V}(z,t)I(z,t)=|V_{0}||I_{o}|e^{-2\alpha z}\cos(\omega t-\beta z)\cos(\omega t-\beta z+\theta)\quad{(57)}
$$
Usually, the time-averaged power, $\langle\mathcal{P}\rangle$, is of interest. We find this through:
$$
\langle\mathcal{P}\rangle=\frac{1}{T}\int_{0}^{T}|V_{0}||I_{0}|e^{-2\alpha z}\cos(\omega t-\beta z)\cos(\omega t-\beta z+\theta)dt\quad{(58)}
$$
where $T=2\pi/\omega$ is the time period for one oscillation cycle. Using a trigonometric identity, the product of cosines in the integrand can be written as the sum of individual cosines at the sum and difference frequencies:
$$
\langle\mathcal{P}\rangle=\frac{1}{T}\int_{0}^{T}\frac{1}{2}|V_{0}||I_{0}|e^{-2\alpha z}[\cos(2\omega t-2\beta z+\theta)+\cos(\theta)]dt\quad{(59)}
$$
The first cosine term integrates to zero, leaving the $\cos\theta$ term. The remaining integral easily evaluates as
$$
\langle\mathcal{P}\rangle=\f

[Truncated for analysis]

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
$$
 \text{Power loss(dB)}=10\log_{10}\left[

[Truncated for analysis]

## Core Ideas

- Both voltage and current amplitudes decay as $e^{-\alpha z}$.
- Power therefore decays as $e^{-2\alpha z}$.
- Time averaging removes the term oscillating at $2\omega$.
- The voltage-current phase factor is $\cos\theta$.
- $\langle\mathcal{P}\rangle=\tfrac12\operatorname{Re}\{V_sI_s^*\}$.
- Only the current phasor is conjugated in the power expression.

## Source Anchors

- Equations (57) through (60) derive average power by direct time integration.
- Equations (61) and (62) give the forward voltage and current phasors.
- Equation (63) states $\langle\mathcal{P}\rangle=\tfrac12\operatorname{Re}\{V_sI_s^*\}$.
- Equation (64) reproduces the time-integrated result.

## Related Pages

- [[attenuation-and-phase-in-a-lossy-line|Attenuation and Phase in a Lossy Line]]
- [[characteristic-impedance-of-a-transmission-line|Characteristic Impedance of a Transmission Line]]
- [[decibel-characterization-of-transmission-loss|Decibel Characterization of Transmission Loss]]
- [[power-reflection-and-load-absorption|Power Reflection and Load Absorption]]

## Concept Dependencies

- depends-on: [[attenuation-and-phase-in-a-lossy-line|Attenuation and Phase in a Lossy Line]]
- depends-on: [[characteristic-impedance-of-a-transmission-line|Characteristic Impedance of a Transmission Line]]
