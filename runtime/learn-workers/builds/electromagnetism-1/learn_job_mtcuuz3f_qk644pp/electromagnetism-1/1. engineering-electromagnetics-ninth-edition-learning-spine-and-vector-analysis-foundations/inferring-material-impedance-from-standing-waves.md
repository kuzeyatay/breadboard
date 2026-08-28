---
title: "1.250 Inferring Material Impedance from Standing Waves"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 431, Example 12.3 statement", "Page 432, Example 12.3 solution"]
related: ["standing-wave-ratio-and-extremum-locations", "reflection-and-transmission-coefficients", "boundary-conditions-require-a-reflected-wave"]
---

# 1.250 Inferring Material Impedance from Standing Waves

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 431, Example 12.3 statement, Page 432, Example 12.3 solution

Standing-wave measurements can determine the intrinsic impedance of an unknown material. The spacing between adjacent maxima or adjacent minima equals one half-wavelength, so it determines $\lambda$ and, in a known incident medium, the frequency or phase constant. The location of the first extremum relative to the interface reveals the phase of the reflection coefficient. A minimum at the interface indicates a real negative $\Gamma$, while a maximum indicates a real positive $\Gamma$ for the lossless cases discussed. The measured standing-wave ratio gives the reflection magnitude through
$$
|\Gamma|=\frac{s-1}{s+1}
$$
 Example 12.3 measures 1.5 m between maxima, so $\lambda=3.0$ m and the air-wave frequency is 100 MHz. The first maximum lies $0.75$ m, or $\lambda/4$, from the interface, implying a boundary minimum and $\Gamma<0$. With $s=5$, $\Gamma=-2/3$, and solving the impedance relation gives $\eta_u=75.4\ \Omega$.

## Page-Grounded Details

#### Page 431

Solution. We calculate $\omega=6\pi\times 10^{9}$ rad/s, $\beta_{1}=\omega\sqrt{\mu_{1}\epsilon_{1}}=40\pi$ rad/m, and $\beta_{2}=$ $\omega\sqrt{\mu_{2}\epsilon_{2}}=60\pi$ rad/m. Although the wavelength would be 10 cm in air, we find here that $\lambda_{1}=2\pi/\beta_{1}=5$ cm, $\lambda_{2}=2\pi/\beta_{2}=3.33$ cm, $\eta_{1}=60\pi$ $\Omega$, $\eta_{2}=40\pi$ $\Omega$, and $\Gamma=$ ($\eta_{2}-\eta_{1}$)/($\eta_{2}+\eta_{1}$)= - 0.2. Because $\Gamma$ is real and negative ($\eta_{2}<\eta_{1}$), there will be a minimum of the electric field at the boundary, and it will be repeated at half-wavelength (2.5 cm) intervals in dielectric 1. From (23), we see that $|E_{x1T}|_{\text{min}}=80$ V/m.

Maxima of E are found at distances of 1.25, 3.75, 6.25, ... cm from z = 0. These maxima all have amplitudes of 120 V/m, as predicted by (20).

There are no maxima or minima in region 2 because there is no reflected wave there.

The ratio of the maximum to minimum amplitudes is the standing wave ratio:
$$
s=\frac{|E_{x1T}|\max}{|E_{x1T}|\min}=\frac{1+|\Gamma|}{1-|\Gamma|}\quad{(27)}
$$
Because $|\Gamma|<1$, s is always positive and greater than or equal to unity.

[Truncated for analysis]

#### Page 432

Solution. The 1.5 m spacing between maxima is $\lambda/2$, which implies that a wavelength is 3.0 m, or $f=100$ MHz. The first maximum at 0.75 m is thus at a distance of $\lambda/4$ from the interface, which means that a field minimum occurs at the boundary. Thus $\Gamma$ will be real and negative. We use (27) to write
$$
|\Gamma| = \frac{s - 1}{s + 1} = \frac{5 - 1}{5 + 1} = \frac{2}{3}
$$
So
$$
\Gamma = -\frac{2}{3} = \frac{\eta_u - \eta_0}{\eta_u + \eta_0}
$$
which we solve for $\eta_u$ to obtain
$$
\eta_u = \frac{1}{5} \eta_0 = \frac{377}{5} = 75.4 \, \Omega
$$
### 12.3 WAVE REFLECTION FROM MULTIPLE INTERFACES

So far we have treated the reflection of waves at the single boundary that occurs between semi-infinite media. In this section, we consider wave reflection from materials that are finite in extent, such that we must consider the effect of the front and back surfaces. Such a two-interface problem would occur, for example, for light incident on a flat piece of glass. Additional interfaces are present if the glass is coated with one or more layers of dielectric material for the purpose (as we will see) of reducing reflections. Such problems in which more tha

[Truncated for analysis]

## Core Ideas

- Adjacent maxima are separated by $\lambda/2$.
- Extremum position relative to the interface determines the reflection phase.
- A boundary minimum implies negative real $\Gamma$ in the stated lossless case.
- The SWR measurement gives $|\Gamma|=(s-1)/(s+1)$.
- The signed reflection coefficient is inserted into $\Gamma=(\eta_u-\eta_0)/(\eta_u+\eta_0)$.
- Solving the coefficient equation yields the unknown intrinsic impedance.

## Source Anchors

- Example 12.3 reports a 1.5 m spacing between maxima.
- The inferred wavelength is 3.0 m and the inferred frequency is 100 MHz.
- The first maximum is 0.75 m from the interface, corresponding to $\lambda/4$.
- The measured standing-wave ratio is 5.
- The example obtains $|\Gamma|=2/3$ and assigns $\Gamma=-2/3$.
- The solved unknown impedance is $\eta_u=\eta_0/5=377/5=75.4\ \Omega$.

## Related Pages

- [[standing-wave-ratio-and-extremum-locations|Standing-Wave Ratio and Extremum Locations]]
- [[reflection-and-transmission-coefficients|Reflection and Transmission Coefficients]]
- [[boundary-conditions-require-a-reflected-wave|Boundary Conditions Require a Reflected Wave]]

