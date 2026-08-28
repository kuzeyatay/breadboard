---
title: "Vector Helmholtz Equation in Free Space"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "vector-helmholtz-equation-in-free-space"
locations: ["Page 386", "Page 387"]
related: ["free-space-electromagnetic-wave-equation", "phasor-representation-of-uniform-plane-waves", "intrinsic-impedance-and-field-orientation", "lossy-dielectric-propagation-and-complex-wavenumber", "uniform-plane-waves-from-sourceless-maxwell-equations"]
---

## ConceptNode: Vector Helmholtz Equation in Free Space

Planning node for [[vector-helmholtz-equation-in-free-space|1.217 Vector Helmholtz Equation in Free Space]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 386, Page 387

Sinusoidal Maxwell equations can be written entirely in phasor form because each time derivative becomes multiplication by $j\omega$. In sourceless free space the curl equations become $\nabla\times\mathbf{H}_s=j\omega\epsilon_0\mathbf{E}_s$ and $\nabla\times\mathbf{E}_s=-j\omega\mu_0\mathbf{H}_s$, while both field divergences vanish. Taking the curl of the electric-field equation and applying the vector identity for $\nabla\times\nabla\times\mathbf{E}_s$ eliminates the magnetic field. Since $\nabla\cdot\mathbf{E}_s=0$, the gradient-of-divergence term vanishes, producing the vector Helmholtz equation $\nabla^2\mathbf{E}_s=-k_0^2\mathbf{E}_s$. Each vector component satisfies a scalar second-order partial differential equation. For a uniform plane wave with no $x$ or $y$ variation, the equation reduces to an ordinary differential equation in $z$. Its two exponential solutions represent forward and backward propagation. This formulation is the frequency-domain counterpart of the time-domain wave equation.

### Key planning details

- Time-harmonic Maxwell equations replace $\partial/\partial t$ with $j\omega$.
- The sourceless phasor fields satisfy zero-divergence conditions.
- The curl-of-curl identity introduces the vector Laplacian.
- The vector Helmholtz equation is $\nabla^2\mathbf{E}_s=-k_0^2\mathbf{E}_s$.
- Each Cartesian component obeys its own scalar Helmholtz equation.
- Uniformity in the transverse plane removes the $x$ and $y$ derivatives.
- The one-dimensional solutions are $e^{-jk_0z}$ and $e^{jk_0z}$.

### Source coverage

- Equations (23) and (24) are $\nabla\times\mathbf{H}_s=j\omega\epsilon_0\mathbf{E}_s$ and $\nabla\times\mathbf{E}_s=-j\omega\mu_0\mathbf{H}_s$.
- Equations (25) and (26) state $\nabla\cdot\mathbf{E}_s=0$ and $\nabla\cdot\mathbf{H}_s=0$.
- Equation (27) applies $\nabla\times\nabla\times\mathbf{E}_s=\nabla(\nabla\cdot\mathbf{E}_s)-\nabla^2\mathbf{E}_s$.
- Equation (28) is $\nabla^2\mathbf{E}_s=-k_0^2\mathbf{E}_s$.
- Equation (30) reduces the uniform-wave problem to $d^2E_{xs}/dz^2=-k_0^2E_{xs}$.
- Equation (31) gives $E_{xs}=E_{x0}e^{-jk_0z}+E_{x0}'e^{jk_0z}$.
