---
title: "Low-Loss Approximation for Characteristic Impedance"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "low-loss-approximation-for-characteristic-impedance"
locations: ["Page 331"]
related: ["characteristic-impedance-of-a-transmission-line", "low-loss-expansion-of-the-propagation-constant", "heaviside-distortionless-line-condition", "average-power-in-a-lossy-transmission-line"]
---

## ConceptNode: Low-Loss Approximation for Characteristic Impedance

Planning node for [[low-loss-approximation-for-characteristic-impedance|1.180 Low-Loss Approximation for Characteristic Impedance]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 331

The characteristic impedance of a low-loss line is approximated by factoring $j\omega L$ and $j\omega C$ from the exact expression and applying the same binomial expansion used for the propagation constant. After rationalizing the denominator and neglecting sufficiently high-order loss products, the result is $$Z_0\doteq\sqrt{\frac{L}{C}}\left\{1+\frac{1}{2\omega^2}\left[\frac14\left(\frac{R}{L}+\frac{G}{C}\right)^2-\frac{G^2}{C^2}\right]+\frac{j}{2\omega}\left(\frac{G}{C}-\frac{R}{L}\right)\right\}.$$ The imaginary component is controlled by the imbalance between dielectric and conductor loss ratios. When $G=0$ and $R\ll\omega L$, the dominant form is $Z_0\doteq\sqrt{L/C}(1-jR/(2\omega L))$. Its magnitude is approximately $\sqrt{L/C}$ and its phase is $\theta=\tan^{-1}[-R/(2\omega L)]$. The negative phase means the current phase leads the voltage phase for this conductor-loss-only approximation.

### Key planning details

- The leading magnitude of low-loss $Z_0$ is $\sqrt{L/C}$.
- The impedance phase depends on $G/C-R/L$.
- Heaviside's condition removes the approximate imaginary correction.
- For $G=0$, $Z_0\doteq\sqrt{L/C}(1-jR/(2\omega L))$.
- For $G=0$, $|Z_0|\doteq\sqrt{L/C}$.
- Higher-order products are neglected under the low-loss assumptions.

### Source coverage

- Equations (55) and (56) develop the low-loss characteristic-impedance approximation.
- The worked case with $G=0$ gives $Z_0\doteq\sqrt{L/C}(1-jR/(2\omega L))$.
- The worked case gives $\theta=\tan^{-1}(-R/(2\omega L))$.
- D10.1 reports $Z_0=50.0-j0.0350\ \Omega$ for the specified practical parameters.
