---
title: "Phasor Representation of Uniform Plane Waves"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "phasor-representation-of-uniform-plane-waves"
locations: ["Page 385", "Page 386"]
related: ["traveling-wave-direction-and-sinusoidal-solutions", "vector-helmholtz-equation-in-free-space", "intrinsic-impedance-and-field-orientation"]
---

## ConceptNode: Phasor Representation of Uniform Plane Waves

Planning node for [[phasor-representation-of-uniform-plane-waves|1.216 Phasor Representation of Uniform Plane Waves]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 385, Page 386

Phasors suppress the common sinusoidal time factor while retaining spatial phase and complex amplitude. A forward field with real instantaneous form $\mathcal{E}_x(z,t)=\Re[E_{xs}(z)e^{j\omega t}]$ has phasor $E_{xs}=E_{x0}e^{-jk_0z}$, where the complex amplitude $E_{x0}$ includes the initial phase. Recovering the time-domain field requires multiplying the phasor by $e^{j\omega t}$ and taking the real part. Example 11.1 applies this directly to a scalar $y$-directed field, preserving the spatial factor and phase while removing the explicit time dependence. Example 11.2 demonstrates the vector case: each Cartesian component can have a different complex amplitude and phase, but all components share the propagation factor for a wave traveling in one direction. The example computes $k_0$ from the frequency and converts the vector phasor into two real cosine components. This procedure is reusable for moving between measured fields, complex amplitudes, and frequency-domain Maxwell equations.

### Key planning details

- A real sinusoidal field is recovered as $\Re[\mathbf{E}_s e^{j\omega t}]$.
- For forward free-space propagation, the spatial phasor factor is $e^{-jk_0z}$.
- The complex amplitude stores both magnitude and initial phase.
- Converting to a phasor removes $\Re$ and suppresses the common factor $e^{j\omega t}$.
- Vector components may have different amplitudes and phases while sharing one propagation factor.
- Mixed angular notation may use radians for spatial phase and degrees for a fixed phase offset.
- Time differentiation of a sinusoidal field corresponds to multiplication of its phasor by $j\omega$.

### Source coverage

- Equation (19) identifies $E_{xs}=E_{x0}e^{-jk_0z}$ and $\mathcal{E}_x=\Re[E_{xs}e^{j\omega t}]$.
- Example 11.1 converts $\mathcal{E}_y=100\cos(10^8t-0.5z+30^\circ)$ V/m to $E_{ys}=100e^{-j0.5z+j30^\circ}$.
- Example 11.2 starts from $\mathbf{E}_0=100\mathbf{a}_x+20\angle30^\circ\mathbf{a}_y$ V/m at 10 MHz.
- Example 11.2 calculates $k_0=0.21$ rad/m.
- The resulting field is $100\cos(2\pi\times10^7t-0.21z)\mathbf{a}_x+20\cos(2\pi\times10^7t-0.21z+30^\circ)\mathbf{a}_y$ V/m.
- Equation (22) demonstrates that time differentiation becomes multiplication by $j\omega$ in phasor form.
