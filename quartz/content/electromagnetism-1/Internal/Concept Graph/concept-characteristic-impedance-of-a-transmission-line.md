---
title: "Characteristic Impedance of a Transmission Line"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "characteristic-impedance-of-a-transmission-line"
locations: ["Page 328", "Page 329"]
related: ["propagation-constant-and-traveling-wave-solutions", "lossless-line-parameter-calculation", "low-loss-approximation-for-characteristic-impedance", "reflection-at-a-load-discontinuity", "phasor-domain-telegraphist-equations"]
---

## ConceptNode: Characteristic Impedance of a Transmission Line

Planning node for [[characteristic-impedance-of-a-transmission-line|1.175 Characteristic Impedance of a Transmission Line]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 328, Page 329

Characteristic impedance relates the voltage and current amplitudes of a single traveling wave. Substituting the general voltage and current solutions into $dV_s/dz=-ZI_s$ and matching the coefficients of the independent exponentials gives $Z_0=V_0^+/I_0^+=-V_0^-/I_0^-$. The minus sign for the backward-wave current reflects its reversed propagation direction under the chosen current reference. Algebraically, $Z_0=Z/\gamma=\sqrt{Z/Y}$, so the distributed line parameters give $$Z_0=\sqrt{\frac{R+j\omega L}{G+j\omega C}}=|Z_0|e^{j\theta}.$$ In a lossy line, $Z_0$ is generally complex, and its phase is the phase difference between voltage and current amplitudes. For a lossless line with $R=G=0$, it reduces to the real value $Z_0=\sqrt{L/C}$. Example 10.2 applies this result to obtain $50\ \Omega$ from the specified inductance and capacitance.

### Key planning details

- $Z_0=V_0^+/I_0^+$ for a forward wave.
- $Z_0=-V_0^-/I_0^-$ for a backward wave.
- $Z_0=\sqrt{Z/Y}$.
- $Z_0=\sqrt{(R+j\omega L)/(G+j\omega C)}$.
- A lossy line generally has complex characteristic impedance.
- For $R=G=0$, $Z_0=\sqrt{L/C}$.

### Source coverage

- Equation (45) equates the forward and backward exponential coefficients.
- Equation (46) derives $Z_0=Z/\gamma=\sqrt{Z/Y}$.
- Equation (47) expresses $Z_0$ in terms of $R$, $L$, $G$, and $C$.
- Example 10.2 calculates $Z_0=50\ \Omega$ for $L=0.25\ \mu\text{H/m}$ and $C=100\ \text{pF/m}$.
