---
title: "1.179 Heaviside Distortionless-Line Condition"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 330", "Page 331"]
related: ["low-loss-expansion-of-the-propagation-constant", "low-loss-approximation-for-characteristic-impedance", "attenuation-and-phase-in-a-lossy-line"]
---

# 1.179 Heaviside Distortionless-Line Condition

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 330, Page 331

The low-loss phase correction depends on the difference between the normalized shunt and series loss terms. If $R/L=G/C$, known as Heaviside's condition, that difference vanishes. The phase constant then reduces to $\beta\doteq\omega\sqrt{LC}$, so $v_p=\omega/\beta$ is independent of frequency within the model. The group velocity $v_g=d\omega/d\beta$ is also constant, preventing the frequency-dependent delay mechanism described as distortion. Under the same condition, the approximate characteristic impedance becomes the real value $Z_0=\sqrt{L/C}$, as it does for a fully lossless line, even though $R$ and $G$ need not be zero. Distortionless behavior and low-loss behavior are therefore distinct: a line can retain attenuation while avoiding dispersion if its distributed loss ratios are balanced. The source cautions that practical line parameters can themselves depend on frequency, so low-loss and distortion-free conditions usually hold only over limited bands.

## Page-Grounded Details

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

- Heaviside's condition is $R/L=G/C$.
- Under this condition, $\beta\doteq\omega\sqrt{LC}$.
- Phase velocity becomes independent of frequency in the stated model.
- Group velocity is also frequency-independent.
- $Z_0$ simplifies to $\sqrt{L/C}$.
- Distortionless propagation can still include attenuation.
- Practical distortionless behavior is usually bandwidth-limited.

## Source Anchors

- Page 330 names $R/L=G/C$ as Heaviside's condition.
- Equation (54b) loses its correction term when the two normalized loss ratios are equal.
- Page 331 states that Equation (56) reduces to $Z_0=\sqrt{L/C}$ under Heaviside's condition.
- The source notes additional complications from frequency dependence in $R$, $G$, $L$, and $C$.

## Related Pages

- [[low-loss-expansion-of-the-propagation-constant|Low-Loss Expansion of the Propagation Constant]]
- [[low-loss-approximation-for-characteristic-impedance|Low-Loss Approximation for Characteristic Impedance]]
- [[attenuation-and-phase-in-a-lossy-line|Attenuation and Phase in a Lossy Line]]

## Concept Dependencies

- derives-from: [[low-loss-expansion-of-the-propagation-constant|Low-Loss Expansion of the Propagation Constant]]
- limits: [[attenuation-and-phase-in-a-lossy-line|Attenuation and Phase in a Lossy Line]]
