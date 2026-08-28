---
title: "1.285 Rectangular Waveguide Cutoff and Propagation"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 501, Eqs. (101)-(103)"]
related: ["te-m0-modes-and-the-dominant-te-10-mode", "te-0p-modes-and-rectangular-guide-single-mode-design", "why-rectangular-waveguides-are-needed"]
---

# 1.285 Rectangular Waveguide Cutoff and Propagation

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 501, Eqs. (101)-(103)

The transverse dimensions a and b, together with the relative permittivity and permeability of the filling material, determine which rectangular-waveguide modes can propagate. For the common case $\mu_r=1$, the refractive index is $n=\sqrt{\epsilon_r}$ and the wave speed in the material is $c/n$. A TE or TM mode indexed by m and p has a cutoff angular frequency set by the quadrature sum of its transverse spatial frequencies. The corresponding cutoff wavelength $\lambda_{Cmp}$ is stated as a free-space wavelength. If the wavelength is measured inside the filling medium, the free-space cutoff value must be divided by n. The longitudinal phase constant $\beta_{mp}$ becomes real only when the operating free-space wavelength $\lambda$ is less than the mode's cutoff wavelength. This gives a direct propagation test: $\lambda<\lambda_{Cmp}$. As the operating frequency rises, more indexed modes satisfy this inequality, so the guide dimensions and material properties determine both the first propagating mode and the number of simultaneously propagating modes.

## Page-Grounded Details

#### Page 501

$b$, along with the material properties, $\epsilon_{r}$ and $\mu_{r}$, will determine the number of modes that will propagate. For the typical case in which $\mu_{r}=1$, using $n=\sqrt{\epsilon_{r}}$, and identi-
fying the speed of light, $c=1/\sqrt{\mu_{0}\epsilon_{0}}$, we may re-write (100) in a manner consistent
with Eq. (41):
$$
\omega_{Cmp}=\frac{c}{n}\left[\left(\frac{m\pi}{a}\right)^{2}+\left(\frac{p\pi}{b}\right)^{2}\right]^{1/2}\quad{(101)}
$$
This would lead to an expression for the cutoff wavelength, $\lambda_{Cmp}$, in a manner con-
sistent with Eq. (43):
$$
\lambda_{Cmp}=\frac{2\pi c}{\omega_{Cmp}}=2n\left[\left(\frac{m}{a}\right)^{2}+\left(\frac{p}{b}\right)^{2}\right]^{-1/2}\quad{(102)}
$$
$\lambda_{Cmp}$ is the free space wavelength at cutoff. If measured in the medium that fills the
waveguide, the cutoff wavelength would be given by Eq. (102) divided by $n$.

Now, in a manner consistent with Eq. (44), Eq. (99) becomes
$$
\beta_{mp}=\frac{2\pi n}{\lambda}\sqrt{1-\left(\frac{\lambda}{\lambda_{Cmp}}\right)^{2}}\quad{(103)}
$$
where $\lambda$ is the free space wavelength. As we saw before, a TE$_{mp}$ or TM$_{mp}$ mode can
propagate if it

[Truncated for analysis]

## Core Ideas

- For $\mu_r=1$, use $n=\sqrt{\epsilon_r}$ and material wave speed $c/n$.
- The cutoff frequency depends on both transverse indices m and p and on dimensions a and b.
- The stated $\lambda_{Cmp}$ is the free-space wavelength at cutoff.
- The cutoff wavelength measured in the filling medium is $\lambda_{Cmp}/n$.
- A TE_mp or TM_mp mode propagates when $\lambda<\lambda_{Cmp}$.
- The phase constant is real above cutoff and loses its propagating character below cutoff.

## Source Anchors

- Equation (101):
$$
\omega_{Cmp}=\frac{c}{n}\left[\left(\frac{m\pi}{a}\right)^2+\left(\frac{p\pi}{b}\right)^2\right]^{1/2}
$$
- Equation (102):
$$
\lambda_{Cmp}=2n\left[\left(\frac{m}{a}\right)^2+\left(\frac{p}{b}\right)^2\right]^{-1/2}
$$
- Equation (103):
$$
\beta_{mp}=\frac{2\pi n}{\lambda}\sqrt{1-\left(\frac{\lambda}{\lambda_{Cmp}}\right)^2}
$$
- The source explicitly states that $\lambda_{Cmp}$ is a free-space wavelength and that the in-medium cutoff wavelength is smaller by a factor n.
- The source states that TE_mp and TM_mp propagation requires the operating wavelength to be less than the cutoff wavelength.

## Related Pages

- [[te-m0-modes-and-the-dominant-te-10-mode|TE_m0 Modes and the Dominant TE_10 Mode]]
- [[te-0p-modes-and-rectangular-guide-single-mode-design|TE_0p Modes and Rectangular-Guide Single-Mode Design]]
- [[why-rectangular-waveguides-are-needed|Why Rectangular Waveguides Are Needed]]

## Concept Dependencies

- applies-to: [[te-m0-modes-and-the-dominant-te-10-mode|TE_m0 Modes and the Dominant TE_10 Mode]]
- applies-to: [[te-0p-modes-and-rectangular-guide-single-mode-design|TE_0p Modes and Rectangular-Guide Single-Mode Design]]
