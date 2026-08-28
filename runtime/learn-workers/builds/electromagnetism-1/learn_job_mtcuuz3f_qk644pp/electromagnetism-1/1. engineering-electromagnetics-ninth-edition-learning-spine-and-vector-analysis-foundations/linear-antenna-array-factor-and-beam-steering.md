---
title: "1.340 Linear Antenna Array Factor and Beam Steering"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 566, Problems 14.19-14.22", "Page 567, Problems 14.24-14.27"]
related: ["dipole-radiation-patterns-and-directivity", "turnstile-antenna-polarization", "antenna-reciprocity-and-link-reversal"]
---

# 1.340 Linear Antenna Array Factor and Beam Steering

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 566, Problems 14.19-14.22, Page 567, Problems 14.24-14.27

The array problems use element spacing, progressive current phase, operating wavelength, and element count to control radiation directions. A two-element array is designed by choosing the smallest spacing $d$ and relative phase $\xi$ that satisfy specified maxima or zeros in the $H$ plane. Frequency changes alter the electrical spacing $2\pi d/\lambda$, so a phase choice fixed at the design frequency can move the maxima when $f$ changes. If phase is produced by a time delay, it scales as $\xi'=\xi f/f_0$, preserving the forward maximum but allowing backward radiation to develop. The front-to-back ratio compares radiation intensities at $\phi=0$ and $\phi=\pi$ in decibels. For larger arrays, the Hansen-Woodyard condition is
$$
\xi=\pm\left(\frac{2\pi d}{\lambda}+\frac{\pi}{n}\right)
$$
 where the sign selects the endfire direction. Other tasks address beam steering toward $\phi=\pm60^\circ$, the spacing required for zero backward radiation, and the narrowing of a broadside beam as $n$ increases. For large $n$, the null-to-null separation is approximated by $\Delta\phi\doteq2\lambda/L$, with $L\doteq nd$.

## Page-Grounded Details

#### Page 566

main lobe intensity. Express your result as the sidelobe level in decibels, given by$S_{s}$ [dB]= 10 $\log_{10}(S_{r,\text{main}}/S_{r,\text{sidelobe}})$. Again, use Figure 14.8 as a guide.

14.16 For a dipole antenna of overall length, $2\ell=1.5\lambda$, (a) evaluate the locations in $\theta$ at which the zeros and maxima in the $E$-plane pattern occur; (b) determine the sidelobe level, as per the definition in Problem 14.14; (c) determine the maximum directivity.

14.17 Consider a lossless half-wave dipole in free space, with radiation resistance, $R_{\text{rad}}=73$ ohms, and maximum directivity $D_{\text{max}}=1.64$. If the antenna carries a 1-A current amplitude, (a) how much total power (in watts) is radiated? (b) How much power is intercepted by a $1-m^{2}$ aperture situated at distance $r=1$ km away? The aperture is on the equatorial plane and squarely faces the antenna. Assume uniform power density over the aperture.

14.18 Repeat Problem 14.17, but with a full-wave antenna ($2\ell=\lambda$). Numerical integrals may be necessary.

14.19 Design a two-element dipole array that will radiate equal intensities in the $\phi=0$, $\pi/2$, $\pi$, and $ 3\

[Truncated for analysis]

#### Page 567

$^{14.23}$ A turnstile antenna consists of two crossed dipole antennas, positioned in this case in the xy plane. The dipoles are identical, lie along the x and y axes, and are both fed at the origin. Assume that equal currents are supplied to each antenna and that a zero phase reference is applied to the x-directed antenna. Determine the relative phase, $\xi$, of the y-directed antenna so that the net radiated electric field as measured on the positive z axis is $(a)$ left circularly polarized; $(b)$ linearly polarized along the $45^{\circ}$ axis between x and y.

$^{14.24}$ Consider a linear endfire array, designed for maximum radiation intensity at $\phi=0$, using $\xi$ and $d$ values as suggested in Example 14.5. Determine an expression for the front-to-back ratio (defined in Problem 14.22) as a function of the number of elements $n$ if $n$ is an odd number.

$^{14.25}$ A six-element linear dipole array has element spacing $d=\lambda/2$. $(a)$ Select the appropriate current phasing $\xi$ to achieve maximum radiation along $\phi=\pm\,60^{\circ}$. $(b)$ With the phase set as in part $a$, evaluate the intensities (relative to the maximum) in the

[Truncated for analysis]

## Core Ideas

- Array patterns depend on progressive phase $\xi$, spacing $d$, wavelength $\lambda$, and element count $n$.
- Broadside, endfire, and intermediate-angle maxima are obtained by controlling relative phase.
- Changing frequency changes electrical spacing and can shift beam directions.
- A time-delay feed produces $\xi'=\xi f/f_0$.
- The Hansen-Woodyard condition adds $\pi/n$ to the ordinary endfire phase magnitude.
- For a large broadside array, $\Delta\phi\doteq2\lambda/L$ with $L\doteq nd$.

## Source Anchors

- Problems 14.19 and 14.20 ask for two-element array spacing, relative phase, zeros, and maxima.
- Problem 14.21 fixes $\xi=-\pi/2$ while changing frequency to $1.5f_0$ and $2f_0$.
- Problem 14.22 gives $\xi'=\xi f/f_0$ and asks for a frequency-dependent front-to-back ratio.
- Problem 14.25 specifies six elements with $d=\lambda/2$ and desired maxima at $\phi=\pm60^\circ$.
- Problem 14.26 states the Hansen-Woodyard condition.
- Problem 14.27 states the large-$n$ approximation $\Delta\phi\doteq2\lambda/L$.

## Related Pages

- [[dipole-radiation-patterns-and-directivity|Dipole Radiation Patterns and Directivity]]
- [[turnstile-antenna-polarization|Turnstile Antenna Polarization]]
- [[antenna-reciprocity-and-link-reversal|Antenna Reciprocity and Link Reversal]]

## Concept Dependencies

- depends-on: [[dipole-radiation-patterns-and-directivity|Dipole Radiation Patterns and Directivity]]
