---
title: "1.178 Low-Loss Expansion of the Propagation Constant"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 329", "Page 330", "Page 331"]
related: ["attenuation-and-phase-in-a-lossy-line", "heaviside-distortionless-line-condition", "low-loss-approximation-for-characteristic-impedance", "decibel-characterization-of-transmission-loss", "propagation-constant-and-traveling-wave-solutions"]
---

# 1.178 Low-Loss Expansion of the Propagation Constant

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 329, Page 330, Page 331

A practical low-loss line satisfies $R\ll\omega L$ and $G\ll\omega C$. Factoring the exact propagation constant isolates two small dimensionless corrections, $R/(j\omega L)$ and $G/(j\omega C)$. Applying the binomial approximation $\sqrt{1+x}\doteq1+x/2-x^2/8$ and neglecting higher-order products produces approximate real and imaginary parts. The attenuation coefficient is
$$
\alpha\doteq\frac12\left(R\sqrt{\frac{C}{L}}+G\sqrt{\frac{L}{C}}\right)
$$
 showing direct first-order dependence on conductor resistance and dielectric conductance. The phase constant is
$$
\beta\doteq\omega\sqrt{LC}\left[1+\frac18\left(\frac{G}{\omega C}-\frac{R}{\omega L}\right)^2\right]
$$
 Because the correction depends on frequency, phase velocity and group velocity can vary with frequency and distort broadband signals. The derivation also indicates that increasing resistance, including resistance increased by skin effect, generally raises loss.

## Page-Grounded Details

#### Page 329

Solution. Because the line is lossless, both R and G are zero. The characteristic impedance is
$$
Z_{0} = \sqrt{\frac{L}{C}} = \sqrt{\frac{0.25 \times 10^{-6}}{100 \times 10^{-12}}} = 50 \Omega
$$
Because $\gamma = \alpha + j\beta = \sqrt{(R + j\omega L)(G + j\omega C)} = j\omega \sqrt{LC}$, we see that
$$
\beta = \omega \sqrt{LC} = 2\pi(600 \times 10^{6}) \sqrt{(0.25 \times 10^{-6})(100 \times 10^{-12})} = 18.85 \text{ rad/m}
$$
Also,
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
\mathcal{V}(z, t) = V_{0}^{+} e^{-\alpha z} \cos(\omega t - \beta z) + V_{0}^{-} e^{\alpha z} \cos(\omega t + \beta z) \quad{(49)}
$$
In this exercise, we have assigned $ V

[Truncated for analysis]

#### Page 330

often true in practice. Before we apply these conditions, Eq. (41) can be written in the form:
$$
\begin{array}[]{l}\gamma=\alpha+j\beta=[(R+j\omega L)(G+j\omega C)]^{1/2}\\=j\omega\sqrt{LC}\left[\left(1+\frac{R}{j\omega L}\right)^{1/2}\left(1+\frac{G}{j\omega C}\right)^{1/2}\right]\end{array}\quad{(50)}
$$
The low-loss approximation then allows us to use the first three terms in the binomial series:
$$
\sqrt{1+x}\doteq 1+\frac{x}{2}-\frac{x^{2}}{8}\quad(x\ll 1)\quad{(51)}
$$
We use (51) to expand the terms in large parentheses in (50), obtaining:
$$
\gamma\doteq j\omega\sqrt{LC}\left[(1+\frac{R}{j 2 \omega L}+\frac{R^{2}}{8 \omega^{2} L^{2}})\left(1+\frac{G}{j 2 \omega C}+\frac{G^{2}}{8 \omega^{2} C^{2}}\right)\right]\quad{(52)}
$$
All products in (52) are then carried out, neglecting the terms involving $RG^{2}$, $R^{2}G$, and $R^{2}G^{2}$, as these will be negligible compared to all others. The result is
$$
\gamma=\alpha+j\beta\doteq j\omega\sqrt{LC}\left[1+\frac{1}{j 2\omega}\left(\frac{R}{L}+\frac{G}{C}\right)+\frac{1}{8\omega^{2}}\left(\frac{R^{2}}{L^{2}}-\frac{2 R G}{LC}+\frac{G^{2}}{C^{2}}\right)\right]\quad{(53)}
$$
Now, separating real and imaginary parts of

[Truncated for analysis]

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

## Core Ideas

- The low-loss conditions are $R\ll\omega L$ and $G\ll\omega C$.
- Use $\sqrt{1+x}\doteq1+x/2-x^2/8$ for small $x$.
- $\alpha$ is first order in $R$ and $G$.
- The correction to $\beta$ is second order in the normalized loss imbalance.
- Frequency-dependent $\beta$ produces frequency-dependent phase velocity.
- Frequency-dependent phase and group velocities can cause signal distortion.

## Source Anchors

- Equations (50) through (53) factor and expand the exact propagation constant.
- Equation (54a) gives the low-loss attenuation coefficient.
- Equation (54b) gives the low-loss phase constant.
- D10.1 reports $\alpha=2.25\ \text{mNp/m}$ and $\beta=2.50\ \text{rad/m}$ for the stated line parameters.
- The text identifies skin effect loss as a reason resistance and loss increase with frequency.

## Related Pages

- [[attenuation-and-phase-in-a-lossy-line|Attenuation and Phase in a Lossy Line]]
- [[heaviside-distortionless-line-condition|Heaviside Distortionless-Line Condition]]
- [[low-loss-approximation-for-characteristic-impedance|Low-Loss Approximation for Characteristic Impedance]]
- [[decibel-characterization-of-transmission-loss|Decibel Characterization of Transmission Loss]]
- [[propagation-constant-and-traveling-wave-solutions|Propagation Constant and Traveling-Wave Solutions]]

## Concept Dependencies

- applies-to: [[attenuation-and-phase-in-a-lossy-line|Attenuation and Phase in a Lossy Line]]
- derives-from: [[propagation-constant-and-traveling-wave-solutions|Propagation Constant and Traveling-Wave Solutions]]
