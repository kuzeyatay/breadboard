---
title: "1.247 Total Reflection from a Perfect Conductor"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 424, perfect-conductor limit", "Page 425, Equations (11) through (14)", "Page 426, Figure 12.2"]
related: ["reflection-and-transmission-coefficients", "standing-wave-ratio-and-extremum-locations", "power-reflectivity-and-conservation", "loss-penetration-depth-and-conductor-power-dissipation"]
---

# 1.247 Total Reflection from a Perfect Conductor

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 424, perfect-conductor limit, Page 425, Equations (11) through (14), Page 426, Figure 12.2

For a perfect conductor, conductivity approaches infinity and the intrinsic impedance of region 2 approaches zero. The transmitted time-varying electric field is therefore zero, while the reflection coefficient becomes $\Gamma=-1$. The reflected electric field has the same amplitude as the incident field but is shifted by $180^\circ$. In a lossless region 1, adding the two counterpropagating fields produces
$$
E_{xs1}=-j2E_{x10}^{+}\sin(\beta_1z)
$$
 with instantaneous form
$$
\mathcal{E}_{x1}(z,t)=2E_{x10}^{+}\sin(\beta_1z)\sin(\omega t)
$$
 This is a standing wave with electric-field nodes at $z=m\lambda_1/2$, including the conducting boundary. The magnetic standing wave is
$$
\mathcal{H}_{y1}(z,t)=2\frac{E_{x10}^{+}}{\eta_1}\cos(\beta_1z)\cos(\omega t)
$$
 Magnetic maxima occur where electric nodes occur, and the two total fields are in time quadrature, producing zero average net power flow.

## Page-Grounded Details

#### Page 424

Solving (8) for $E_{x20}^{+}$ and substituting into (7), we find
$$
E_{x10}^{+}+E_{x10}^{-}=\frac{\eta_{2}}{\eta_{1}}E_{x10}^{+}-\frac{\eta_{2}}{\eta_{1}}E_{x10}^{-}
$$
or
$$
E_{x10}^{-}= E_{x10}^{+}\frac{\eta_{2}-\eta_{1}}{\eta_{2}+\eta_{1}}
$$
The ratio of the amplitudes of the reflected and incident electric fields defines the reflection coefficient, designated by $\Gamma$,
$$
\Gamma=\frac{E_{x10}^{-}}{E_{x10}^{+}}=\frac{\eta_{2}-\eta_{1}}{\eta_{2}+\eta_{1}}=|\Gamma|e^{j\phi_{r}}\quad{(9)}
$$
It is evident that as $\eta_{1}$ or $\eta_{2}$ may be complex, $\Gamma$ will also be complex, and so we include a reflective phase shift, $\phi_{r}$. The interpretation of Eq. (9) is identical to that used with transmission lines [Eq. (73), Chapter 10].

The relative amplitude of the transmitted electric field intensity is found by combining (9) and (7) to yield the transmission coefficient, $\tau$,
$$
\tau=\frac{E_{x20}^{+}}{E_{x10}^{+}}=\frac{2\eta_{2}}{\eta_{1}+\eta_{2}}=1+\Gamma=|\tau|e^{j\phi_{t}}\quad{(10)}
$$
whose form and interpretation are consistent with the usage in transmission lines [Eq. (75), Chapter 10].

#### 12.1.3 Total Reflection: Standing Wave Rati

[Truncated for analysis]

#### Page 425

sign indicates that at the boundary (or at the moment of reflection), the reflected field is shifted in phase by $180^{\circ}$ relative to the incident field. The total $\mathbf{E}$ field in region 1 is
$$
\begin{align*}E_{xs1}&=E_{xs1}^{+}+E_{xs1}^{-}\\ &=E_{x10}^{+}e^{-j\beta_{1}z}-E_{x10}^{+}e^{j\beta_{1}z}\end{align*}
$$
where we have let $jk_{1}=0+j\beta_{1}$ in the perfect dielectric. These terms may be com-bined and simplified,
$$
\begin{align*}E_{xs1}&=(e^{-j\beta_{1}z}-e^{j\beta_{1}z})E_{x10}^{+}\\ &=-j2\sin(\beta_{1}z)E_{x10}^{+}\end{align*}\qquad(11)
$$
Multiplying (11) by $e^{j\omega t}$ and taking the real part, we obtain the real instantaneous form:
$$
\mathcal{E}_{x1}(z,t)=2E_{x10}^{+}\sin(\beta_{1}z)\sin(\omega t)\quad{(12)}
$$
We recognize this total field in region 1 as a standing wave, obtained by combining two waves of equal amplitude traveling in opposite directions. We first encountered standing waves in transmission lines, but in the form of counterpropagating voltage waves (see Example 10.1).

Again, we compare the form of (12) to that of the incident wave,
$$
\mathcal{E}_{x1}(z,t)=E_{x10}^{+}\cos(\omega t-\beta_{1}z)\quad{(13)}
$$
Here we se

[Truncated for analysis]

#### Page 426

Figure 12.2 The instantaneous values of the total field $E_{x1}$ are shown at $\omega t=\pi/2$. $E_{x1}=0$ for all time at multiples of one half-wavelength from the conducting surface.

#### 12.1.4 Partial Reflection and Power Reflectivity

Now suppose that perfect dielectrics exist in both regions 1 and 2, so that $\eta_{1}$ and $\eta_{2}$ are both real positive quantities and $\alpha_{1}=\alpha_{2}=0$. Equation (9) enables us to calculate the reflection coefficient and find $E_{x1}^{-}$ in terms of the incident field $E_{x1}^{+}$. Knowing $E_{x1}^{+}$ and $E_{x1}^{-}$, we then find $H_{y1}^{+}$ and $H_{y1}^{-}$. In region 2, $E_{x2}^{+}$ is found from (10), and this then determines $H_{y2}^{+}$.

#### EXAMPLE 12.1

As a numerical example we select
$$
\begin{array}[]{rcl}\eta_{1}&=&100~{}\Omega\\\eta_{2}&=&300~{}\Omega\\ E_{x10}^{+}&=&100~{}\text{V/m}\end{array}
$$
and calculate values for the incident, reflected, and transmitted waves.

**Solution.** The reflection coefficient is
$$
\Gamma=\frac{300-100}{300+100}=0.5
$$
and thus
$$
E_{x10}^{-}=50~{}\text{V/m}
$$
## Core Ideas

- A perfect conductor has $\eta_2=0$ and zero skin depth.
- No time-varying transmitted field exists inside the perfect conductor.
- $\Gamma=-1$ gives complete reflection with a $180^\circ$ electric-field phase reversal.
- Equal counterpropagating amplitudes form a standing wave.
- Electric-field nodes occur at $z=m\lambda_1/2$.
- The conducting surface at $z=0$ is an electric-field node.
- Magnetic maxima coincide with electric nodes.
- The time-average net Poynting power is zero.

## Source Anchors

- Page 424 derives $\eta_2=0$, $E_{x20}^{+}=0$, and $\Gamma=-1$ for a perfect conductor.
- Equation (11) gives $E_{xs1}=-j2\sin(\beta_1z)E_{x10}^{+}$.
- Equation (12) gives the instantaneous electric standing wave.
- The node condition is $z=m\lambda_1/2$.
- Equation (14) gives the magnetic standing wave.
- Figure 12.2 shows electric-field zeros at half-wavelength multiples from the conducting surface.

## Related Pages

- [[reflection-and-transmission-coefficients|Reflection and Transmission Coefficients]]
- [[standing-wave-ratio-and-extremum-locations|Standing-Wave Ratio and Extremum Locations]]
- [[power-reflectivity-and-conservation|Power Reflectivity and Conservation]]
- [[loss-penetration-depth-and-conductor-power-dissipation|Loss, Penetration Depth, and Conductor Power Dissipation]]

## Concept Dependencies

- example-of: [[standing-wave-ratio-and-extremum-locations|Standing-Wave Ratio and Extremum Locations]]
