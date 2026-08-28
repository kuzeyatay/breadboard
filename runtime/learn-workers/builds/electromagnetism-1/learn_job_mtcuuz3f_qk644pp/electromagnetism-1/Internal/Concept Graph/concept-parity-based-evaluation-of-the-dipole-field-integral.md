---
title: "Parity-Based Evaluation of the Dipole Field Integral"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "parity-based-evaluation-of-the-dipole-field-integral"
locations: ["Page 543", "Page 544", "Section 14.4.2"]
related: ["finite-dipole-as-a-superposition-of-hertzian-dipoles", "dipole-e-plane-pattern-function", "radiation-intensity-directivity-and-radiation-resistance"]
---

## ConceptNode: Parity-Based Evaluation of the Dipole Field Integral

Planning node for [[parity-based-evaluation-of-the-dipole-field-integral|1.319 Parity-Based Evaluation of the Dipole Field Integral]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 543, Page 544, Section 14.4.2

The finite-dipole field integral is simplified by exploiting symmetry. After writing $e^{jkz\cos\theta}$ as cosine plus $j$ times sine, the current factor $\sin[k(\ell-|z|)]$ is recognized as even in $z$. Its product with $\cos(kz\cos\theta)$ is also even, while its product with $\sin(kz\cos\theta)$ is odd. The odd contribution integrates to zero over the symmetric interval from $-\ell$ to $+\ell$. The remaining even integral can therefore be evaluated as twice the integral from $0$ to $\ell$. Product-to-sum identities then convert the product of sine and cosine into integrable sine terms. This procedure yields the angular numerator $\cos(k\ell\cos\theta)-\cos(k\ell)$ and a factor involving $\sin^2\theta$. Recombining this integral with the prefactor produces a separable far-zone field: a constant field amplitude, an angular pattern function, and the spherical propagation factor $e^{-jkr}/r$. The derivation illustrates why geometric symmetry is central to antenna integration and why the final field depends only on $\theta$ for a single vertical dipole.

### Key planning details

- The current distribution $\sin[k(\ell-|z|)]$ is even in $z$.
- The cosine term from Euler's identity is even, while the sine term is odd.
- The product of the even current and odd sine term integrates to zero over symmetric limits.
- The surviving integral is doubled and evaluated over $0\le z\le\ell$.
- Product-to-sum identities reduce the remaining product to elementary sine integrals.
- The evaluated integral contains $\cos(k\ell\cos\theta)-\cos(k\ell)$.
- The resulting field separates into amplitude, angular pattern, and radial propagation factors.

### Source coverage

- Page 544 explicitly labels the current and cosine terms as even and the sine term as odd.
- Page 544 states that the imaginary, odd-parity part integrates to zero from $-\ell$ to $+\ell$.
- The surviving term is written as $2A\int_0^\ell\sin[k(\ell-z)]\cos(kz\cos\theta)\,dz$.
- The evaluated integral is $2A[\cos(k\ell\cos\theta)-\cos(k\ell)]/[k\sin^2\theta]$.
- The final field is $E_{\theta s}=j\frac{I_0\eta}{2\pi r}e^{-jkr}[\cos(k\ell\cos\theta)-\cos(k\ell)]/\sin\theta$.
- The field amplitude is identified as $E_0=jI_0\eta/(2\pi)$.
