---
title: "1.39 Cylindrical Integration of an Electron-Beam Charge"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 46", "Page 47", "Section: Volume Integral Example"]
related: ["volume-charge-density-and-total-enclosed-charge", "electric-field-integral-for-a-volume-charge-distribution", "multipoles-finite-charge-distributions-and-far-field-limits"]
---

# 1.39 Cylindrical Integration of an Electron-Beam Charge

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 46, Page 47, Section: Volume Integral Example

The electron-beam example demonstrates how to convert a spatial charge density into total charge by selecting limits and a differential volume suited to the geometry. The beam occupies a cylindrical region with $0\leq\rho\leq0.01\,\mathrm{m}$, $0\leq\phi\leq2\pi$, and $0.02\leq z\leq0.04\,\mathrm{m}$. In cylindrical coordinates, $dv=\rho\,d\rho\,d\phi\,dz$, so the Jacobian factor $\rho$ must appear in the integrand. The chosen integration order begins with $\phi$, which immediately contributes a factor of $2\pi$. Integrating next with respect to $z$ simplifies the final radial integral because the exponential contains the product $\rho z$. The negative density indicates electron charge, so the enclosed charge is negative. This example provides a reusable workflow: identify the charged region, write the correct coordinate differential, choose an efficient order, apply all bounds, and verify the sign and units.

## Page-Grounded Details

#### Page 46

As an example of the evaluation of a volume integral, we find the total charge contained in a 2-cm length of the electron beam shown in Figure 2.5.

**Solution.** From the illustration, we see that the charge density is
$$
\rho_{v}=-5\times 10^{-6}\,e^{-10^{5}\rho z}\,\mathrm{C/m^{2}}
$$
The volume differential in cylindrical coordinates is given in Section 1.8; therefore,
$$
Q=\int_{0.02}^{0.04}\int_{0}^{2\pi}\int_{0}^{0.01}-5\times 10^{-6}\,e^{-10^{5}\rho z}\rho\,d\rho\,d\phi\,dz
$$
We integrate first with respect to $\phi$ because it is so easy,
$$
Q=\int_{0.02}^{0.04}\int_{0}^{0.01}-10^{-5}\pi e^{-10^{5}\rho z}\rho\,d\rho\,dz
$$
and then with respect to $z$, because this will simplify the last integration with respect to $\rho$,
$$
\begin{align*}Q&=\int_{0}^{0.01}\left(\frac{-10^{-5}\pi}{-10^{5}\rho}e^{-10^{5}\rho z}\rho\,d\rho\right)_{z=0.02}^{z=0.04}\\ &=\int_{0}^{0.01}-10^{-5}\pi(e^{-2000\rho}-e^{-4000\rho})\,d\rho\end{align*}
$$
Figure 2.5 The total charge contained within the right circular cylinder may be obtained by evaluating $Q=\int_{\rm vol}\rho_{v}dv$.

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

- The beam is modeled with an exponentially varying cylindrical charge density.
- The cylindrical volume element is $dv=\rho\,d\rho\,d\phi\,dz$.
- The limits describe a $2\,\mathrm{cm}$ beam segment and a radius of $1\,\mathrm{cm}$.
- Integrating over $\phi$ first exploits full rotational symmetry.
- Integrating over $z$ before $\rho$ simplifies the exponential dependence.
- The negative density produces a negative total electron-beam charge.

## Source Anchors

- The density is given as $\rho_v=-5\times10^{-6}e^{-10^5\rho z}$.
- The integral is
$$
Q=\int_{0.02}^{0.04}\int_0^{2\pi}\int_0^{0.01}-5\times10^{-6}e^{-10^5\rho z}\rho\,d\rho\,d\phi\,dz
$$
- After the $\phi$ integration, the coefficient becomes $-10^{-5}\pi$.
- The remaining radial exponentials are $e^{-2000\rho}$ and $e^{-4000\rho}$.
- The evaluated magnitude is $0.0785\,\mathrm{pC}$, with negative sign implied by the electron density and preceding derivation.
- Source figure S1.P46.F1, Figure 2.5, shows the right circular cylinder over which $Q=\int_{\mathrm{vol}}\rho_vdv$ is evaluated.

## Related Pages

- [[volume-charge-density-and-total-enclosed-charge|Volume Charge Density and Total Enclosed Charge]]
- [[electric-field-integral-for-a-volume-charge-distribution|Electric Field Integral for a Volume Charge Distribution]]
- [[multipoles-finite-charge-distributions-and-far-field-limits|Multipoles, Finite Charge Distributions, and Far-Field Limits]]

## Concept Dependencies

- example-of: [[volume-charge-density-and-total-enclosed-charge|Volume Charge Density and Total Enclosed Charge]]
