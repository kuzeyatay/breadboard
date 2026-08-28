---
title: "1.180 Low-Loss Approximation for Characteristic Impedance"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 331"]
related: ["characteristic-impedance-of-a-transmission-line", "low-loss-expansion-of-the-propagation-constant", "heaviside-distortionless-line-condition", "average-power-in-a-lossy-transmission-line"]
---

# 1.180 Low-Loss Approximation for Characteristic Impedance

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 331

The characteristic impedance of a low-loss line is approximated by factoring $j\omega L$ and $j\omega C$ from the exact expression and applying the same binomial expansion used for the propagation constant. After rationalizing the denominator and neglecting sufficiently high-order loss products, the result is
$$
Z_0\doteq\sqrt{\frac{L}{C}}\left\{1+\frac{1}{2\omega^2}\left[\frac14\left(\frac{R}{L}+\frac{G}{C}\right)^2-\frac{G^2}{C^2}\right]+\frac{j}{2\omega}\left(\frac{G}{C}-\frac{R}{L}\right)\right\}
$$
 The imaginary component is controlled by the imbalance between dielectric and conductor loss ratios. When $G=0$ and $R\ll\omega L$, the dominant form is $Z_0\doteq\sqrt{L/C}(1-jR/(2\omega L))$. Its magnitude is approximately $\sqrt{L/C}$ and its phase is $\theta=\tan^{-1}[-R/(2\omega L)]$. The negative phase means the current phase leads the voltage phase for this conductor-loss-only approximation.

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

## Core Ideas

- The leading magnitude of low-loss $Z_0$ is $\sqrt{L/C}$.
- The impedance phase depends on $G/C-R/L$.
- Heaviside's condition removes the approximate imaginary correction.
- For $G=0$, $Z_0\doteq\sqrt{L/C}(1-jR/(2\omega L))$.
- For $G=0$, $|Z_0|\doteq\sqrt{L/C}$.
- Higher-order products are neglected under the low-loss assumptions.

## Source Anchors

- Equations (55) and (56) develop the low-loss characteristic-impedance approximation.
- The worked case with $G=0$ gives $Z_0\doteq\sqrt{L/C}(1-jR/(2\omega L))$.
- The worked case gives $\theta=\tan^{-1}(-R/(2\omega L))$.
- D10.1 reports $Z_0=50.0-j0.0350\ \Omega$ for the specified practical parameters.

## Related Pages

- [[characteristic-impedance-of-a-transmission-line|Characteristic Impedance of a Transmission Line]]
- [[low-loss-expansion-of-the-propagation-constant|Low-Loss Expansion of the Propagation Constant]]
- [[heaviside-distortionless-line-condition|Heaviside Distortionless-Line Condition]]
- [[average-power-in-a-lossy-transmission-line|Average Power in a Lossy Transmission Line]]

## Concept Dependencies

- derives-from: [[characteristic-impedance-of-a-transmission-line|Characteristic Impedance of a Transmission Line]]
- related: [[heaviside-distortionless-line-condition|Heaviside Distortionless-Line Condition]]
