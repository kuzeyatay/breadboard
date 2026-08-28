---
title: "1.223 Fresh-Water Plane-Wave Calculation"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 393"]
related: ["lossless-dielectric-plane-wave-propagation", "microwave-absorption-and-penetration-in-water", "good-dielectric-approximation"]
---

# 1.223 Fresh-Water Plane-Wave Calculation

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 393

Example 11.3 applies the lossless dielectric formulas to a 1 MHz plane wave in fresh water. At this frequency, water losses are treated as negligible, with $\epsilon''\doteq 0$, $\mu_r=1$, and $\epsilon'_r=81$. The phase constant is computed from $\beta=\omega\sqrt{\mu\epsilon'}=(\omega/c)\sqrt{\epsilon'_r}$, giving $0.19\ \mathrm{rad/m}$. The wavelength then follows from $\lambda=2\pi/\beta$ and equals $33\ \mathrm{m}$, while the phase velocity is $v_p=\omega/\beta=3.3\times10^7\ \mathrm{m/s}$. Both are smaller than their free-space or air values because the relative permittivity is large. The intrinsic impedance becomes $\eta=\eta_0/\sqrt{\epsilon'_r}=42\ \Omega$. For an electric-field amplitude of $0.1\ \mathrm{V/m}$, the magnetic-field amplitude is $E_{x0}/\eta=2.4\times10^{-3}\ \mathrm{A/m}$. The nearby polyethylene exercise reinforces the same procedure: determine $\beta$, then $\lambda$, $v_p$, $\eta$, and finally the magnetic-field amplitude.

## Page-Grounded Details

#### Page 393

The two fields are once again perpendicular to each other, perpendicular to the direction of propagation, and in phase with each other everywhere. Note that when E is crossed into H, the resultant vector is in the direction of propagation. We shall see the reason for this when we discuss the Poynting vector.

​// Example 11.3

Let us apply these results to a 1-MHz plane wave propagating in fresh water. At this frequency, losses in water are negligible, which means that we can assume that $\epsilon^{\prime\prime}\doteq 0$. In water, $\mu_{r}=1$ and at 1 MHz, $\epsilon_{r}^{\prime}=81$.

Solution. We begin by calculating the phase constant. Using (45) with $\epsilon^{\prime\prime}=0$, we have
$$
\beta=\omega\sqrt{\mu\epsilon^{\prime}}=\omega\sqrt{\mu_{0}\epsilon_{0}}\,\sqrt{\epsilon_{r}^{\prime}}=\frac{\omega\sqrt{\epsilon_{r}^{\prime}}}{c}=\frac{2\pi\times 10^{6}\sqrt{81}}{3.0\times 10^{8}}=0.19\,\mathrm{rad/m}
$$
Using this result, we can determine the wavelength and phase velocity:
$$
\lambda=\frac{2\pi}{\beta}=\frac{2\pi}{.19}=33\mathrm{~m}
$$
$$
v_{p}=\frac{\omega}{\beta}=\frac{2\pi\times 10^{6}}{.19}=3.3\times 10^{7}\,\mathrm{m/s}
$$
The wavelength in air would hav

[Truncated for analysis]

## Core Ideas

- Fresh water at 1 MHz is approximated as lossless.
- The material parameters are $\mu_r=1$ and $\epsilon'_r=81$.
- The calculated phase constant is $\beta=0.19\ \mathrm{rad/m}$.
- The wavelength is $33\ \mathrm{m}$, compared with $300\ \mathrm{m}$ in air.
- The phase velocity is $3.3\times10^7\ \mathrm{m/s}$.
- The intrinsic impedance is $42\ \Omega$.
- An electric amplitude of $0.1\ \mathrm{V/m}$ produces a magnetic amplitude of $2.4\times10^{-3}\ \mathrm{A/m}$.

## Source Anchors

- Example 11.3 specifies a 1 MHz wave, $\mu_r=1$, and $\epsilon'_r=81$.
- The calculation gives $\beta=(2\pi\times10^6\sqrt{81})/(3.0\times10^8)=0.19\ \mathrm{rad/m}$.
- The source obtains $\lambda=2\pi/0.19=33\ \mathrm{m}$.
- The source obtains $v_p=(2\pi\times10^6)/0.19=3.3\times10^7\ \mathrm{m/s}$.
- The impedance calculation gives $\eta=377/9=42\ \Omega$.
- Exercise D11.3 gives polyethylene results of $295\ \mathrm{rad/m}$, $2.13\ \mathrm{cm}$, $1.99\times10^8\ \mathrm{m/s}$, $251\ \Omega$, and $1.99\ \mathrm{A/m}$.

## Related Pages

- [[lossless-dielectric-plane-wave-propagation|Lossless Dielectric Plane-Wave Propagation]]
- [[microwave-absorption-and-penetration-in-water|Microwave Absorption and Penetration in Water]]
- [[good-dielectric-approximation|Good-Dielectric Approximation]]

## Concept Dependencies

- applies-to: [[lossless-dielectric-plane-wave-propagation|Lossless Dielectric Plane-Wave Propagation]]
