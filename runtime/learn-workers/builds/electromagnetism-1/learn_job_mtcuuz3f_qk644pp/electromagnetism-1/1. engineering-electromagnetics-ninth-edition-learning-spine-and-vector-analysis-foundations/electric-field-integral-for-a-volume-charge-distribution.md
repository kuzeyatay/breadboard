---
title: "1.40 Electric Field Integral for a Volume Charge Distribution"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 47", "Section: 2.3.2 Electric Field Associated with a Volume Charge Distribution"]
related: ["superposition-of-point-charge-electric-fields", "volume-charge-density-and-total-enclosed-charge", "electric-flux-density-from-charge", "free-space-relationship-between-electric-flux-density-and-electric-field"]
---

# 1.40 Electric Field Integral for a Volume Charge Distribution

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 47, Section: 2.3.2 Electric Field Associated with a Volume Charge Distribution

The field of a continuous volume distribution follows by treating each infinitesimal charge element as a point charge and applying superposition. A source element at $\mathbf{r}'$ contains $dQ=\rho_v(\mathbf{r}')dv'$. Its contribution at the field point $\mathbf{r}$ points from the source toward the field point, along $\mathbf{r}-\mathbf{r}'$. Dividing this displacement by its magnitude produces the required unit vector. Letting the source volume shrink to differential size provides spatial resolution for a nonuniform density and converts the discrete sum into a volume integral. The primes are essential: $\mathbf{r}$ is fixed while evaluating the field, whereas $\mathbf{r}'$ ranges over the source distribution. In rectangular coordinates, the integration variables are $x'$, $y'$, and $z'$. This distinction between source and field coordinates is foundational for later electromagnetic integral formulations.

## Page-Grounded Details

#### Page 47

Finally,
$$
\begin{align*}Q&=-10^{-10}\pi\left(\frac{e^{-2000\rho}}{-2000}-\frac{e^{-4000\rho}}{-4000}\right)_ {0}^{0.01}\\ Q&=-10^{-10}\pi(\frac{1}{2000}-\frac{1}{4000})=\frac{-\pi}{40}=0.0785\,\text{pC}\end{align*}
$$
where pC indicates picocoulombs.

#### 2.3.2 Electric Field Associated with a Volume Charge Distribution

Consider an incremental charge, $\Delta Q$ at $\mathbf{r}^{\prime}$ that represents a small portion of a larger charge volume of density $\rho_{v}$, which in general may vary with position. $\Delta Q$ lies within a small volume $\Delta v$, and is thus treated as a point charge, where $\Delta Q=\rho_{v}\Delta v$ as before. The incremental contribution to the electric field intensity at $\mathbf{r}$ associated with this charge is written, using (10):
$$
\Delta E(\mathbf{r})=\frac{\Delta Q}{4\pi\epsilon_{0}|\mathbf{r}-\mathbf{r}^{\prime}|^{2}}\frac{\mathbf{r}-\mathbf{r}^{\prime}}{|\mathbf{r}-\mathbf{r}^{\prime}|}=\frac{\rho_{v}\,\Delta v}{4\pi\epsilon_{0}|\mathbf{r}-\mathbf{r}^{\prime}|^{2}}\frac{\mathbf{r}-\mathbf{r}^{\prime}}{|\mathbf{r}-\mathbf{r}^{\prime}|}
$$
The above gives the field contribution at $\mathbf{r}$ for the small volume of cha

[Truncated for analysis]

## Core Ideas

- An incremental source charge is $dQ=\rho_v(\mathbf{r}')dv'$.
- The field point $\mathbf{r}$ remains fixed during source integration.
- The source point $\mathbf{r}'$ ranges throughout the charged volume.
- The scalar separation is $|\mathbf{r}-\mathbf{r}'|$.
- The direction from source to field point is $(\mathbf{r}-\mathbf{r}')/|\mathbf{r}-\mathbf{r}'|$.
- The continuous field is a vector triple integral.

## Source Anchors

- The incremental field is
$$
\Delta\mathbf{E}(\mathbf{r})=\frac{\rho_v\Delta v}{4\pi\epsilon_0|\mathbf{r}-\mathbf{r}'|^2}\frac{\mathbf{r}-\mathbf{r}'}{|\mathbf{r}-\mathbf{r}'|}
$$
- Equation (15):
$$
\mathbf{E}(\mathbf{r})=\int_{\mathrm{vol}}\frac{\rho_v(\mathbf{r}')dv'}{4\pi\epsilon_0|\mathbf{r}-\mathbf{r}'|^2}\frac{\mathbf{r}-\mathbf{r}'}{|\mathbf{r}-\mathbf{r}'|}
$$
- The text identifies $\mathbf{r}$ as the field-point position and $\mathbf{r}'$ as the source-point position.
- In rectangular coordinates, the source integration variables are $x'$, $y'$, and $z'$.
- Shrinking $\Delta v$ both increases spatial resolution and changes the summation into an integral.

## Related Pages

- [[superposition-of-point-charge-electric-fields|Superposition of Point-Charge Electric Fields]]
- [[volume-charge-density-and-total-enclosed-charge|Volume Charge Density and Total Enclosed Charge]]
- [[electric-flux-density-from-charge|Electric Flux Density from Charge]]
- [[free-space-relationship-between-electric-flux-density-and-electric-field|Free-Space Relationship Between Electric Flux Density and Electric Field]]

## Concept Dependencies

- derives-from: [[superposition-of-point-charge-electric-fields|Superposition of Point-Charge Electric Fields]]
- related: [[free-space-relationship-between-electric-flux-density-and-electric-field|Free-Space Relationship Between Electric Flux Density and Electric Field]]
