---
title: "1.175 Characteristic Impedance of a Transmission Line"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 328", "Page 329"]
related: ["propagation-constant-and-traveling-wave-solutions", "lossless-line-parameter-calculation", "low-loss-approximation-for-characteristic-impedance", "reflection-at-a-load-discontinuity", "phasor-domain-telegraphist-equations"]
---

# 1.175 Characteristic Impedance of a Transmission Line

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 328, Page 329

Characteristic impedance relates the voltage and current amplitudes of a single traveling wave. Substituting the general voltage and current solutions into $dV_s/dz=-ZI_s$ and matching the coefficients of the independent exponentials gives $Z_0=V_0^+/I_0^+=-V_0^-/I_0^-$. The minus sign for the backward-wave current reflects its reversed propagation direction under the chosen current reference. Algebraically, $Z_0=Z/\gamma=\sqrt{Z/Y}$, so the distributed line parameters give
$$
Z_0=\sqrt{\frac{R+j\omega L}{G+j\omega C}}=|Z_0|e^{j\theta}
$$
 In a lossy line, $Z_0$ is generally complex, and its phase is the phase difference between voltage and current amplitudes. For a lossless line with $R=G=0$, it reduces to the real value $Z_0=\sqrt{L/C}$. Example 10.2 applies this result to obtain $50\ \Omega$ from the specified inductance and capacitance.

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

- $Z_0=V_0^+/I_0^+$ for a forward wave.
- $Z_0=-V_0^-/I_0^-$ for a backward wave.
- $Z_0=\sqrt{Z/Y}$.
- $Z_0=\sqrt{(R+j\omega L)/(G+j\omega C)}$.
- A lossy line generally has complex characteristic impedance.
- For $R=G=0$, $Z_0=\sqrt{L/C}$.

## Source Anchors

- Equation (45) equates the forward and backward exponential coefficients.
- Equation (46) derives $Z_0=Z/\gamma=\sqrt{Z/Y}$.
- Equation (47) expresses $Z_0$ in terms of $R$, $L$, $G$, and $C$.
- Example 10.2 calculates $Z_0=50\ \Omega$ for $L=0.25\ \mu\text{H/m}$ and $C=100\ \text{pF/m}$.

## Related Pages

- [[propagation-constant-and-traveling-wave-solutions|Propagation Constant and Traveling-Wave Solutions]]
- [[lossless-line-parameter-calculation|Lossless-Line Parameter Calculation]]
- [[low-loss-approximation-for-characteristic-impedance|Low-Loss Approximation for Characteristic Impedance]]
- [[reflection-at-a-load-discontinuity|Reflection at a Load Discontinuity]]
- [[phasor-domain-telegraphist-equations|Phasor-Domain Telegraphist Equations]]

## Concept Dependencies

- derives-from: [[phasor-domain-telegraphist-equations|Phasor-Domain Telegraphist Equations]]
- depends-on: [[propagation-constant-and-traveling-wave-solutions|Propagation Constant and Traveling-Wave Solutions]]
