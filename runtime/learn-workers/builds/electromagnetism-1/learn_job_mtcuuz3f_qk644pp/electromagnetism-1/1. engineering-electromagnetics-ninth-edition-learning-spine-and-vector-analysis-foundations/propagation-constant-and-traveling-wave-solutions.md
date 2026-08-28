---
title: "1.174 Propagation Constant and Traveling-Wave Solutions"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 327", "Page 328", "Page 329"]
related: ["phasor-domain-telegraphist-equations", "characteristic-impedance-of-a-transmission-line", "attenuation-and-phase-in-a-lossy-line", "average-power-in-a-lossy-transmission-line"]
---

# 1.174 Propagation Constant and Traveling-Wave Solutions

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 327, Page 328, Page 329

The phasor wave equation is governed by the complex propagation constant $\gamma$, defined by $\gamma=\sqrt{(R+j\omega L)(G+j\omega C)}=\sqrt{ZY}=\alpha+j\beta$. The general voltage solution is $V_s(z)=V_0^+e^{-\gamma z}+V_0^-e^{\gamma z}$, and the current has the corresponding form $I_s(z)=I_0^+e^{-\gamma z}+I_0^-e^{\gamma z}$. The superscripts identify net waves traveling in the positive and negative $z$ directions. Separating $\gamma$ into real and imaginary parts reveals two physical effects: $\alpha$ controls exponential amplitude change and $\beta$ controls spatial phase accumulation. The forward wave contains $e^{-\alpha z}e^{-j\beta z}$, while the backward wave contains $e^{\alpha z}e^{j\beta z}$ under the selected coordinate convention. These solutions provide the common mathematical structure used throughout the later analysis of low-loss behavior, reflected waves, power attenuation, and finite line impedance.

## Page-Grounded Details

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

- $\gamma=\sqrt{ZY}=\alpha+j\beta$.
- $\alpha$ is the attenuation coefficient and $\beta$ is the phase constant.
- The voltage solution is $V_0^+e^{-\gamma z}+V_0^-e^{\gamma z}$.
- The current solution has the same exponential structure.
- The two terms represent forward and backward propagation.
- Separating $\gamma$ exposes amplitude attenuation and spatial phase.

## Source Anchors

- Equation (41) defines $\gamma$.
- Equations (42a) and (42b) give the general voltage and current phasor solutions.
- Equation (48) expands the voltage solution using $\gamma=\alpha+j\beta$.
- Equation (49) converts the lossy forward and backward waves to real instantaneous form.

## Related Pages

- [[phasor-domain-telegraphist-equations|Phasor-Domain Telegraphist Equations]]
- [[characteristic-impedance-of-a-transmission-line|Characteristic Impedance of a Transmission Line]]
- [[attenuation-and-phase-in-a-lossy-line|Attenuation and Phase in a Lossy Line]]
- [[average-power-in-a-lossy-transmission-line|Average Power in a Lossy Transmission Line]]

## Concept Dependencies

- derives-from: [[phasor-domain-telegraphist-equations|Phasor-Domain Telegraphist Equations]]
