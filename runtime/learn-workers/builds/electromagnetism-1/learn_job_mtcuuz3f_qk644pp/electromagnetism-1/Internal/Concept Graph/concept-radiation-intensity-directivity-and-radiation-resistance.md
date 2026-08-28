---
title: "Radiation Intensity, Directivity, and Radiation Resistance"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "radiation-intensity-directivity-and-radiation-resistance"
locations: ["Page 545", "Page 546", "Section 14.4.3", "Problem D14.4"]
related: ["dipole-e-plane-pattern-function", "half-wave-dipole-pattern-and-performance", "monopole-antenna-and-image-theory", "effective-area-and-the-transmit-receive-power-ratio"]
---

## ConceptNode: Radiation Intensity, Directivity, and Radiation Resistance

Planning node for [[radiation-intensity-directivity-and-radiation-resistance|1.321 Radiation Intensity, Directivity, and Radiation Resistance]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 545, Page 546, Section 14.4.3, Problem D14.4

Once the dipole pattern function is known, its principal radiation metrics follow from the far-zone Poynting vector. Since $H_{\phi s}=E_{\theta s}/\eta$, the radiation intensity is $K(\theta)=r^2S_r=(1/2)\operatorname{Re}\{E_{\theta s}H_{\phi s}^*\}r^2$. Substitution of the finite-dipole field gives $K(\theta)=\eta I_0^2[F(\theta)]^2/(8\pi^2)$. In free space, where $\eta_0=120\pi$, this becomes $K(\theta)=15I_0^2[F(\theta)]^2/\pi$ watts per steradian. Total radiated power is obtained by integrating radiation intensity over solid angle. Axial symmetry removes any explicit $\phi$ dependence, leaving $P_r=30I_0^2\int_0^\pi[F(\theta)]^2\sin\theta\,d\theta$. Directivity compares radiation intensity in a chosen direction with the angular average, while radiation resistance is defined so that the radiated power equals the power associated with an equivalent input resistance. Both quantities are therefore governed by the same weighted pattern integral.

### Key planning details

- Radiation intensity is $K=r^2S_r$ and has units of watts per steradian.
- The far-zone relation is $H_{\phi s}=E_{\theta s}/\eta$.
- In free space, $K(\theta)=15I_0^2[F(\theta)]^2/\pi$.
- Total radiated power is the integral of $K$ over all solid angles.
- For an axially symmetric dipole, $P_r=30I_0^2\int_0^\pi[F(\theta)]^2\sin\theta\,d\theta$.
- Directivity is $D(\theta)=2[F(\theta)]^2/\int_0^\pi[F(\theta)]^2\sin\theta\,d\theta$.
- Maximum directivity uses the maximum value of $[F(\theta)]^2$.
- Radiation resistance is $R_{\mathrm{rad}}=60\int_0^\pi[F(\theta)]^2\sin\theta\,d\theta$.

### Source coverage

- Equation (60), Page 545 gives $K(\theta)=\eta I_0^2[F(\theta)]^2/(8\pi^2)=15I_0^2[F(\theta)]^2/\pi$ in free space.
- Equation (61), Page 545 defines total radiated power as an integral over $4\pi$ steradians.
- Equation (62), Page 545 reduces the free-space power to a single integral over $\theta$.
- Equations (63) and (64), Page 546 give directional and maximum directivity.
- Equation (65), Page 546 gives radiation resistance.
- Problem D14.4 reports power-density percentages at $\theta=45^\circ$ of 45.7%, 38.6%, and 3.7% for lengths $\lambda/4$, $\lambda/2$, and $\lambda$.
