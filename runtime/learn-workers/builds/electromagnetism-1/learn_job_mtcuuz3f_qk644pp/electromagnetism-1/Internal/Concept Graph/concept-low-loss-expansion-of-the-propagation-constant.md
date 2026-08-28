---
title: "Low-Loss Expansion of the Propagation Constant"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "low-loss-expansion-of-the-propagation-constant"
locations: ["Page 329", "Page 330", "Page 331"]
related: ["attenuation-and-phase-in-a-lossy-line", "heaviside-distortionless-line-condition", "low-loss-approximation-for-characteristic-impedance", "decibel-characterization-of-transmission-loss", "propagation-constant-and-traveling-wave-solutions"]
---

## ConceptNode: Low-Loss Expansion of the Propagation Constant

Planning node for [[low-loss-expansion-of-the-propagation-constant|1.178 Low-Loss Expansion of the Propagation Constant]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 329, Page 330, Page 331

A practical low-loss line satisfies $R\ll\omega L$ and $G\ll\omega C$. Factoring the exact propagation constant isolates two small dimensionless corrections, $R/(j\omega L)$ and $G/(j\omega C)$. Applying the binomial approximation $\sqrt{1+x}\doteq1+x/2-x^2/8$ and neglecting higher-order products produces approximate real and imaginary parts. The attenuation coefficient is $$\alpha\doteq\frac12\left(R\sqrt{\frac{C}{L}}+G\sqrt{\frac{L}{C}}\right),$$ showing direct first-order dependence on conductor resistance and dielectric conductance. The phase constant is $$\beta\doteq\omega\sqrt{LC}\left[1+\frac18\left(\frac{G}{\omega C}-\frac{R}{\omega L}\right)^2\right].$$ Because the correction depends on frequency, phase velocity and group velocity can vary with frequency and distort broadband signals. The derivation also indicates that increasing resistance, including resistance increased by skin effect, generally raises loss.

### Key planning details

- The low-loss conditions are $R\ll\omega L$ and $G\ll\omega C$.
- Use $\sqrt{1+x}\doteq1+x/2-x^2/8$ for small $x$.
- $\alpha$ is first order in $R$ and $G$.
- The correction to $\beta$ is second order in the normalized loss imbalance.
- Frequency-dependent $\beta$ produces frequency-dependent phase velocity.
- Frequency-dependent phase and group velocities can cause signal distortion.

### Source coverage

- Equations (50) through (53) factor and expand the exact propagation constant.
- Equation (54a) gives the low-loss attenuation coefficient.
- Equation (54b) gives the low-loss phase constant.
- D10.1 reports $\alpha=2.25\ \text{mNp/m}$ and $\beta=2.50\ \text{rad/m}$ for the stated line parameters.
- The text identifies skin effect loss as a reason resistance and loss increase with frequency.
