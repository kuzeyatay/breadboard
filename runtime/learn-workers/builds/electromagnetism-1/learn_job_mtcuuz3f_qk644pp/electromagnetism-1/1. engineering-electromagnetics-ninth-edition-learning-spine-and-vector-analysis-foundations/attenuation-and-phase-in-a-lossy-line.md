---
title: "1.177 Attenuation and Phase in a Lossy Line"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 329"]
related: ["propagation-constant-and-traveling-wave-solutions", "low-loss-expansion-of-the-propagation-constant", "average-power-in-a-lossy-transmission-line", "decibel-characterization-of-transmission-loss"]
---

# 1.177 Attenuation and Phase in a Lossy Line

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 329

Writing $\gamma=\alpha+j\beta$ separates loss from phase propagation. The forward voltage phasor contains $e^{-\alpha z}e^{-j\beta z}$, so its amplitude decreases exponentially as it propagates toward increasing $z$. The backward term uses $e^{\alpha z}e^{j\beta z}$ because it propagates toward decreasing $z$ in the coordinate system used. The attenuation coefficient $\alpha$ is measured in nepers per meter, while $\beta$ is measured in radians per meter. The wavelength and phase velocity remain $\lambda=2\pi/\beta$ and $v_p=\omega/\beta$, even when $\beta$ depends on loss parameters. Exact zero attenuation requires $R=G=0$, giving $\gamma=j\omega\sqrt{LC}$ and $v_p=1/\sqrt{LC}$. When $R$ and $G$ are nonzero, both attenuation and frequency-dependent phase behavior can occur.

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

## Core Ideas

- Voltage amplitude changes according to the real part $\alpha$ of $\gamma$.
- Spatial phase changes according to the imaginary part $\beta$ of $\gamma$.
- $\alpha$ has units of Np/m.
- $\lambda=2\pi/\beta$.
- $v_p=\omega/\beta$.
- Exact lossless propagation requires $R=G=0$.

## Source Anchors

- Equation (48) separates each propagation factor into attenuation and phase terms.
- Equation (49) shows attenuated forward and backward real voltage waves.
- The source states that $\alpha=0$ only when $R=G=0$.
- The source retains the definitions $v_p=\omega/\beta$ and $\lambda=2\pi/\beta$.

## Related Pages

- [[propagation-constant-and-traveling-wave-solutions|Propagation Constant and Traveling-Wave Solutions]]
- [[low-loss-expansion-of-the-propagation-constant|Low-Loss Expansion of the Propagation Constant]]
- [[average-power-in-a-lossy-transmission-line|Average Power in a Lossy Transmission Line]]
- [[decibel-characterization-of-transmission-loss|Decibel Characterization of Transmission Loss]]

## Concept Dependencies

- derives-from: [[propagation-constant-and-traveling-wave-solutions|Propagation Constant and Traveling-Wave Solutions]]
