---
title: "1.176 Lossless-Line Parameter Calculation"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 328", "Page 329"]
related: ["characteristic-impedance-of-a-transmission-line", "propagation-constant-and-traveling-wave-solutions", "attenuation-and-phase-in-a-lossy-line", "finite-lossless-line-input-impedance"]
---

# 1.176 Lossless-Line Parameter Calculation

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 328, Page 329

For a lossless transmission line, setting $R=0$ and $G=0$ simplifies the principal line quantities. Characteristic impedance becomes $Z_0=\sqrt{L/C}$, the propagation constant becomes $\gamma=j\omega\sqrt{LC}$, the phase constant is $\beta=\omega\sqrt{LC}$, and phase velocity is $v_p=\omega/\beta=1/\sqrt{LC}$. Example 10.2 demonstrates the calculation for an $80$ cm line operating at $600$ MHz with $L=0.25\ \mu\text{H/m}$ and $C=100\ \text{pF/m}$. It obtains $Z_0=50\ \Omega$, $\beta=18.85\ \text{rad/m}$, and $v_p=2\times10^8\ \text{m/s}$. The physical line length is not needed for these intrinsic per-unit-length propagation quantities, although it would be needed to calculate the total electrical phase length $\beta l$. This example provides a reusable calculation sequence from distributed inductance, capacitance, and operating frequency.

## Page-Grounded Details

#### Page 328

The wave equation for current will be identical in form to (40). We therefore expect the phasor current to be in the form:
$$
I_{s}(z)=I_{0}^{+}e^{-\gamma z}+I_{0}^{-}e^{\gamma z}\quad{(42b)}
$$
The relation between the current and voltage waves is now found, as before, through the telegraphist's equations, (5) and (8). In a manner consistent with Eq. (37b), we write the sinusoidal current as
$$
I(z,t)=|I_{0}|\cos(\omega t\pm\beta z+\xi)=\frac{1}{2}\frac{(|I_{0}|e^{j\xi})}{I_{0}}e^{\pm j\beta z}e^{j\omega t}+\mathrm{c.c.}=\frac{1}{2}I_{s}(z)e^{j\omega t}+\mathrm{c.c.}
$$
(43)

Substituting the far right-hand sides of (37b) and (43) into (5) and (8) transforms the latter equations as follows:
$$
\frac{\partial\mathcal{V}}{\partial z}=-\left(R\mathcal{I}+L\,\frac{\partial\mathcal{I}}{\partial t}\right)\Rightarrow\frac{dV_{s}}{dz}=-(R+j\omega L)I_{s}=-ZI_{s}\quad{(44a)}
$$
and
$$
\frac{\partial\mathcal{I}}{\partial z}=-\left(G\mathcal{V}+C\,\frac{\partial\mathcal{V}}{\partial t}\right)\Rightarrow\frac{dI_{s}}{dz}=-(G+j\omega C)V_{s}=-YV_{s}\quad{(44b)}
$$
We can now substitute (42a) and (42b) into either (44a) or (44b) [we will use (44a)] to find:
$$
-\gamma V_{0}^{+}e^{-\gam

[Truncated for analysis]

#### Page 329

Solution. Because the line is lossless, both R and G are zero. The characteristic impedance is
$$
 Z_{0} = \sqrt{\frac{L}{C}} = \sqrt{\frac{0.25 \times 10^{-6}}{100 \times 10^{-12}}} = 50 \Omega
$$
Because $\gamma = \alpha + j\beta = \sqrt{(R + j\omega L)(G + j\omega C)} = j\omega \sqrt{LC}$, we see that
$$
 \beta = \omega \sqrt{LC} = 2\pi(600 \times 10^{6}) \sqrt{(0.25 \times 10^{-6})(100 \times 10^{-12})} = 18.85 \text{ rad/m}
$$
Also
$$
 v_{p} = \frac{\omega}{\beta} = \frac{2\pi(600 \times 10^{6})}{18.85} = 2 \times 10^{8} \text{m/s}
$$
#### 10.7 LOW-LOSS PROPAGATION

Having obtained the phasor forms of voltage and current in a general transmission line [Eqs. (42a) and (42b)], we can now look more closely at the significance of these results. First we incorporate (41) into (42a) to obtain
$$
 V_{s}(z) = V_{0}^{+} e^{-\alpha z} e^{-j\beta z} + V_{0}^{-} e^{\alpha z} e^{j\beta z} \quad{(48)}
$$
Next, multiplying (48) by $e^{j\omega t}$ and taking the real part gives the real instantaneous voltage:
$$
 \mathcal{V}(z, t) = V_{0}^{+} e^{-\alpha z} \cos(\omega t - \beta z) + V_{0}^{-} e^{\alpha z} \cos(\omega t + \beta z) \quad{(49)} $$
In this exercise, we have assigned $ V

[Truncated for analysis]

## Core Ideas

- Lossless operation means $R=G=0$.
- $Z_0=\sqrt{L/C}$.
- $\beta=\omega\sqrt{LC}$.
- $v_p=1/\sqrt{LC}=\omega/\beta$.
- Use $\omega=2\pi f$ before evaluating $\beta$.
- Electrical length is obtained separately as $\beta l$.

## Source Anchors

- Example 10.2 specifies $f=600$ MHz, $L=0.25\ \mu\text{H/m}$, and $C=100\ \text{pF/m}$.
- The example obtains $Z_0=50\ \Omega$.
- The calculated phase constant is $18.85\ \text{rad/m}$.
- The calculated phase velocity is $2\times10^8\ \text{m/s}$.

## Related Pages

- [[characteristic-impedance-of-a-transmission-line|Characteristic Impedance of a Transmission Line]]
- [[propagation-constant-and-traveling-wave-solutions|Propagation Constant and Traveling-Wave Solutions]]
- [[attenuation-and-phase-in-a-lossy-line|Attenuation and Phase in a Lossy Line]]
- [[finite-lossless-line-input-impedance|Finite Lossless Line Input Impedance]]

## Concept Dependencies

- applies-to: [[characteristic-impedance-of-a-transmission-line|Characteristic Impedance of a Transmission Line]]
- applies-to: [[propagation-constant-and-traveling-wave-solutions|Propagation Constant and Traveling-Wave Solutions]]
