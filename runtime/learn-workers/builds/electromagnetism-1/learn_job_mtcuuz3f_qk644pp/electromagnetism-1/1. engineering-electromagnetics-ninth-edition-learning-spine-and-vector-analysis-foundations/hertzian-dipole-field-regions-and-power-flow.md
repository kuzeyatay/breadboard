---
title: "1.336 Hertzian Dipole Field Regions and Power Flow"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 564, Problems 14.1-14.5", "Page 565, Problem 14.6"]
related: ["radiation-resistance-and-current-distribution", "dipole-radiation-patterns-and-directivity", "magnetic-dipole-and-electric-dipole-comparison"]
---

# 1.336 Hertzian Dipole Field Regions and Power Flow

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 564, Problems 14.1-14.5, Page 565, Problem 14.6

The chapter problems organize the Hertzian dipole field into near-zone and far-zone behaviors. In the near zone, where $kr\ll1$, only the dominant inverse-power terms survive in the electric-field components. The resulting electric field is to be compared with the static electric dipole field, with a relation established between static dipole charge $Q$ and current amplitude $I_0$. The $1/r^2$ magnetic-field term is similarly compared with the Biot-Savart field of a short current element. For the complete time-harmonic field, the average power flow is obtained from
$$
\langle\mathbf{S}\rangle=\frac{1}{2}\operatorname{Re}\{\mathbf{E}_s\times\mathbf{H}_s^*\}
$$
 Comparing the result with the far-zone expression distinguishes reactive near-field behavior from outward radiated power. Other exercises require the instantaneous electric-field direction, the fraction of total power radiated within an angular belt, and spatial loci on which either radiation-field amplitude or average radiated power density has a specified value. These tasks reinforce that far-zone field magnitude scales as $1/r$, whereas radiated power density scales as $1/r^2$, with both retaining the dipole's angular dependence.

## Page-Grounded Details

#### Page 564

### REFERENCES

1. Balanis, C. Antenna Theory: Analysis and Design. 3d ed. Hoboken, N. J.: Wiley, 2005. A widely used text at the advanced senior or graduate level, offering much detail.

2. Silver, S., ed. Microwave Antenna Theory and Design. London: Peter Peregrinus, Ltd on behalf of IEE, 1984. This is a reprint of volume 9 of the famous MIT Radiation Laboratory series, originally published by McGraw-Hill in 1949. It contains much information from original sources that later appeared in modern textbooks.

3. Jordan, E. C., and K. G. Balmain. Electromagnetic Waves and Radiating Systems. 2d ed. Englewood Cliffs, N. J.: Prentice-Hall, 1968. A classic text, covering waveguides and antennas.

4. Blake, L. V. Antennas. New York: Wiley, 1966. A short, well-written, and very readable text at a basic level.

5. Smith, G. S. An Introduction to Classical Electromagnetic Radiation. Cambridge, U. K.: Cambridge University Press, 1997. This excellent graduate-level text provides a unique perspective and rigorous treatment of the radiation problem as related to all types of antennas.

### CHAPTER 14 PROBLEMS

14.1 $\boxed{\text{[1]}}$ A short dipole-carrying current $I_{0}\cos\omega t$ in th

[Truncated for analysis]

#### Page 565

to a current element of differential length $d$, oriented along the $z$ axis, and centered at the origin.

$\underline{14.6}$ Evaluate the time-average Poynting vector, $<S>=\left(\frac{1}{2}\right)\mathcal{R}e\left\{E_{s}\times H_{s}^{*}\right\}$ for the Hertzian dipole, assuming the general case that involves the field components as given by Eqs. (10), (13$a$), and (13$b$). Compare your result to the far-zone case, Eq. (26).

$\underline{14.7}$ A short current element has $d=0.03\lambda$. Calculate the radiation resistance that is obtained for each of the following current distributions: ($a$) uniform, $I_{0}$; ($b$) linear, $I(z)=I_{0}(0.5d-|z|)/0.5d$; ($c$) step, $I_{0}$ for $0<|z|<0.25d$ and $0.5I_{0}$ for $0.25d<|z|<0.5d$.

$\underline{14.8}$ Evaluate the time-average Poynting vector, $<S>=(1/2)\mathcal{R}e\left\{E_{s}\times H_{s}^{*}\right\}$ for the magnetic dipole antenna in the far zone, in which all terms of order $1/r^{2}$ and $1/r^{4}$ are neglected in Eqs. (48), (49), and (50). Compare your result to the far-zone power density of the Hertzian dipole, Eq. (26). In this comparison, and assuming equal current amplitudes, what rel

[Truncated for analysis]

## Core Ideas

- The near-zone condition is $kr\ll1$.
- Near-zone electric fields reduce to dominant terms and can be compared with a static electric dipole.
- The Hertzian dipole magnetic $1/r^2$ term can be compared with the Biot-Savart law.
- Average power flow is $\langle\mathbf{S}\rangle=\frac{1}{2}\operatorname{Re}\{\mathbf{E}_s\times\mathbf{H}_s^*\}$.
- Far-zone radiation-field amplitude scales as $1/r$.
- Far-zone average radiated power density scales as $1/r^2$.

## Source Anchors

- Problem 14.1 asks for instantaneous electric-field direction and the fraction of power radiated in $80^\circ<\theta<100^\circ$.
- Problem 14.2 asks for polar loci where $|E_{\theta s}|$ or $\langle S_r\rangle$ is one-half a reference value.
- Problem 14.4 specifies $kr\ll1$ and asks for comparison with the static dipole result.
- Problem 14.5 isolates the $1/r^2$ magnetic-field term and compares it with Biot-Savart.
- Problem 14.6 requires evaluation of the general time-average Poynting vector and comparison with the far-zone case.

## Related Pages

- [[radiation-resistance-and-current-distribution|Radiation Resistance and Current Distribution]]
- [[dipole-radiation-patterns-and-directivity|Dipole Radiation Patterns and Directivity]]
- [[magnetic-dipole-and-electric-dipole-comparison|Magnetic Dipole and Electric Dipole Comparison]]

## Concept Dependencies

- enables: [[radiation-resistance-and-current-distribution|Radiation Resistance and Current Distribution]]
- enables: [[dipole-radiation-patterns-and-directivity|Dipole Radiation Patterns and Directivity]]
