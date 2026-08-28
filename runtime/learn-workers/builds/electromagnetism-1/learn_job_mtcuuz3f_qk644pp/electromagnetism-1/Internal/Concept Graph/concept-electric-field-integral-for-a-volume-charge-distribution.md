---
title: "Electric Field Integral for a Volume Charge Distribution"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "electric-field-integral-for-a-volume-charge-distribution"
locations: ["Page 47", "Section: 2.3.2 Electric Field Associated with a Volume Charge Distribution"]
related: ["superposition-of-point-charge-electric-fields", "volume-charge-density-and-total-enclosed-charge", "electric-flux-density-from-charge", "free-space-relationship-between-electric-flux-density-and-electric-field"]
---

## ConceptNode: Electric Field Integral for a Volume Charge Distribution

Planning node for [[electric-field-integral-for-a-volume-charge-distribution|1.40 Electric Field Integral for a Volume Charge Distribution]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 47, Section: 2.3.2 Electric Field Associated with a Volume Charge Distribution

The field of a continuous volume distribution follows by treating each infinitesimal charge element as a point charge and applying superposition. A source element at $\mathbf{r}'$ contains $dQ=\rho_v(\mathbf{r}')dv'$. Its contribution at the field point $\mathbf{r}$ points from the source toward the field point, along $\mathbf{r}-\mathbf{r}'$. Dividing this displacement by its magnitude produces the required unit vector. Letting the source volume shrink to differential size provides spatial resolution for a nonuniform density and converts the discrete sum into a volume integral. The primes are essential: $\mathbf{r}$ is fixed while evaluating the field, whereas $\mathbf{r}'$ ranges over the source distribution. In rectangular coordinates, the integration variables are $x'$, $y'$, and $z'$. This distinction between source and field coordinates is foundational for later electromagnetic integral formulations.

### Key planning details

- An incremental source charge is $dQ=\rho_v(\mathbf{r}')dv'$.
- The field point $\mathbf{r}$ remains fixed during source integration.
- The source point $\mathbf{r}'$ ranges throughout the charged volume.
- The scalar separation is $|\mathbf{r}-\mathbf{r}'|$.
- The direction from source to field point is $(\mathbf{r}-\mathbf{r}')/|\mathbf{r}-\mathbf{r}'|$.
- The continuous field is a vector triple integral.

### Source coverage

- The incremental field is $$\Delta\mathbf{E}(\mathbf{r})=\frac{\rho_v\Delta v}{4\pi\epsilon_0|\mathbf{r}-\mathbf{r}'|^2}\frac{\mathbf{r}-\mathbf{r}'}{|\mathbf{r}-\mathbf{r}'|}.$$
- Equation (15): $$\mathbf{E}(\mathbf{r})=\int_{\mathrm{vol}}\frac{\rho_v(\mathbf{r}')dv'}{4\pi\epsilon_0|\mathbf{r}-\mathbf{r}'|^2}\frac{\mathbf{r}-\mathbf{r}'}{|\mathbf{r}-\mathbf{r}'|}.$$
- The text identifies $\mathbf{r}$ as the field-point position and $\mathbf{r}'$ as the source-point position.
- In rectangular coordinates, the source integration variables are $x'$, $y'$, and $z'$.
- Shrinking $\Delta v$ both increases spatial resolution and changes the summation into an integral.
