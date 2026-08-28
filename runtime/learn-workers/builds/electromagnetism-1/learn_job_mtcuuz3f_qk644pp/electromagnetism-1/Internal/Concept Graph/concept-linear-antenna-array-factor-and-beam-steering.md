---
title: "Linear Antenna Array Factor and Beam Steering"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "linear-antenna-array-factor-and-beam-steering"
locations: ["Page 566, Problems 14.19-14.22", "Page 567, Problems 14.24-14.27"]
related: ["dipole-radiation-patterns-and-directivity", "turnstile-antenna-polarization", "antenna-reciprocity-and-link-reversal"]
---

## ConceptNode: Linear Antenna Array Factor and Beam Steering

Planning node for [[linear-antenna-array-factor-and-beam-steering|1.340 Linear Antenna Array Factor and Beam Steering]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 566, Problems 14.19-14.22, Page 567, Problems 14.24-14.27

The array problems use element spacing, progressive current phase, operating wavelength, and element count to control radiation directions. A two-element array is designed by choosing the smallest spacing $d$ and relative phase $\xi$ that satisfy specified maxima or zeros in the $H$ plane. Frequency changes alter the electrical spacing $2\pi d/\lambda$, so a phase choice fixed at the design frequency can move the maxima when $f$ changes. If phase is produced by a time delay, it scales as $\xi'=\xi f/f_0$, preserving the forward maximum but allowing backward radiation to develop. The front-to-back ratio compares radiation intensities at $\phi=0$ and $\phi=\pi$ in decibels. For larger arrays, the Hansen-Woodyard condition is $$\xi=\pm\left(\frac{2\pi d}{\lambda}+\frac{\pi}{n}\right),$$ where the sign selects the endfire direction. Other tasks address beam steering toward $\phi=\pm60^\circ$, the spacing required for zero backward radiation, and the narrowing of a broadside beam as $n$ increases. For large $n$, the null-to-null separation is approximated by $\Delta\phi\doteq2\lambda/L$, with $L\doteq nd$.

### Key planning details

- Array patterns depend on progressive phase $\xi$, spacing $d$, wavelength $\lambda$, and element count $n$.
- Broadside, endfire, and intermediate-angle maxima are obtained by controlling relative phase.
- Changing frequency changes electrical spacing and can shift beam directions.
- A time-delay feed produces $\xi'=\xi f/f_0$.
- The Hansen-Woodyard condition adds $\pi/n$ to the ordinary endfire phase magnitude.
- For a large broadside array, $\Delta\phi\doteq2\lambda/L$ with $L\doteq nd$.

### Source coverage

- Problems 14.19 and 14.20 ask for two-element array spacing, relative phase, zeros, and maxima.
- Problem 14.21 fixes $\xi=-\pi/2$ while changing frequency to $1.5f_0$ and $2f_0$.
- Problem 14.22 gives $\xi'=\xi f/f_0$ and asks for a frequency-dependent front-to-back ratio.
- Problem 14.25 specifies six elements with $d=\lambda/2$ and desired maxima at $\phi=\pm60^\circ$.
- Problem 14.26 states the Hansen-Woodyard condition.
- Problem 14.27 states the large-$n$ approximation $\Delta\phi\doteq2\lambda/L$.
