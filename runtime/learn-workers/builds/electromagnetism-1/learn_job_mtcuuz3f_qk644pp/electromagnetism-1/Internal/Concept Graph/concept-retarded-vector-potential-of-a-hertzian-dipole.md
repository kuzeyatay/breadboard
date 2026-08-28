---
title: "Retarded Vector Potential of a Hertzian Dipole"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "retarded-vector-potential-of-a-hertzian-dipole"
locations: ["Page 528", "Page 529", "Section 14.1.1", "Figure 14.2"]
related: ["radiation-from-time-varying-currents-and-the-hertzian-dipole-model", "general-electromagnetic-fields-of-a-hertzian-dipole", "near-field-and-far-field-behavior"]
---

## ConceptNode: Retarded Vector Potential of a Hertzian Dipole

Planning node for [[retarded-vector-potential-of-a-hertzian-dipole|1.307 Retarded Vector Potential of a Hertzian Dipole]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 528, Page 529, Section 14.1.1, Figure 14.2

The retarded vector magnetic potential accounts for the finite propagation time between a current source and an observation point. For a general filamentary current, the source contribution is evaluated at the retarded time $t-R/v$, where $R$ is source-to-observer distance and $v=1/\sqrt{\mu\epsilon}$ is the phase velocity in the surrounding lossless medium. Because the Hertzian filament is differential and carries uniform current, no spatial integration is required. Its vector potential points along $z$ and decreases as $1/R$. For sinusoidal excitation, the retarded current becomes $I_0\cos(\omega t-kR)$, where $k=\omega/v=\omega\sqrt{\mu\epsilon}$. In phasor form, propagation delay appears as $e^{-jkR}$. The resulting potential is then resolved into spherical components because the subsequent curl operation is most naturally evaluated in spherical coordinates. Projection of $\mathbf{a}_z$ gives a radial component proportional to $\cos\theta$ and a polar component proportional to $-\sin\theta$. This coordinate decomposition provides the direct starting point for deriving the magnetic and electric fields.

### Key planning details

- Retarded time is $t-R/v$.
- The phase velocity is $v=1/\sqrt{\mu\epsilon}$.
- The medium wavenumber is $k=\omega/v=\omega\sqrt{\mu\epsilon}$.
- The outgoing-wave phase factor is $e^{-jkr}$.
- The Hertzian-dipole potential has only a $z$ component before coordinate conversion.
- The potential amplitude decreases as $1/r$.
- Projection gives radial and polar spherical components.
- The spherical components are used to calculate $\nabla\times\mathbf{A}_s$.

### Source coverage

- The general retarded potential is $$\mathbf{A}=\int\frac{\mu I[t-R/v]d\mathbf{L}}{4\pi R}.$$
- For the differential filament, $$\mathbf{A}=\frac{\mu I[t-R/v]d}{4\pi R}\mathbf{a}_z.$$
- The retarded current is $$I[t-R/v]=I_0\cos(\omega t-kR).$$
- The phasor potential is $$\mathbf{A}_s=\frac{\mu I_0d}{4\pi r}e^{-jkr}\mathbf{a}_z.$$
- The spherical components are $$A_{rs}=\frac{\mu I_0d}{4\pi r}\cos\theta\,e^{-jkr}$$ and $$A_{\theta s}=-\frac{\mu I_0d}{4\pi r}\sin\theta\,e^{-jkr}.$$
- Figure 14.2 depicts the resolution of $A_{zs}$ into $A_{rs}$ and $A_{\theta s}$.
