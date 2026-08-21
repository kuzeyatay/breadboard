---
title: "Attenuation and Phase in a Lossy Line"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "attenuation-and-phase-in-a-lossy-line"
locations: ["Page 329"]
related: ["propagation-constant-and-traveling-wave-solutions", "low-loss-expansion-of-the-propagation-constant", "average-power-in-a-lossy-transmission-line", "decibel-characterization-of-transmission-loss"]
---

## ConceptNode: Attenuation and Phase in a Lossy Line

Planning node for [[attenuation-and-phase-in-a-lossy-line|1.177 Attenuation and Phase in a Lossy Line]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 329

Writing $\gamma=\alpha+j\beta$ separates loss from phase propagation. The forward voltage phasor contains $e^{-\alpha z}e^{-j\beta z}$, so its amplitude decreases exponentially as it propagates toward increasing $z$. The backward term uses $e^{\alpha z}e^{j\beta z}$ because it propagates toward decreasing $z$ in the coordinate system used. The attenuation coefficient $\alpha$ is measured in nepers per meter, while $\beta$ is measured in radians per meter. The wavelength and phase velocity remain $\lambda=2\pi/\beta$ and $v_p=\omega/\beta$, even when $\beta$ depends on loss parameters. Exact zero attenuation requires $R=G=0$, giving $\gamma=j\omega\sqrt{LC}$ and $v_p=1/\sqrt{LC}$. When $R$ and $G$ are nonzero, both attenuation and frequency-dependent phase behavior can occur.

### Key planning details

- Voltage amplitude changes according to the real part $\alpha$ of $\gamma$.
- Spatial phase changes according to the imaginary part $\beta$ of $\gamma$.
- $\alpha$ has units of Np/m.
- $\lambda=2\pi/\beta$.
- $v_p=\omega/\beta$.
- Exact lossless propagation requires $R=G=0$.

### Source coverage

- Equation (48) separates each propagation factor into attenuation and phase terms.
- Equation (49) shows attenuated forward and backward real voltage waves.
- The source states that $\alpha=0$ only when $R=G=0$.
- The source retains the definitions $v_p=\omega/\beta$ and $\lambda=2\pi/\beta$.
