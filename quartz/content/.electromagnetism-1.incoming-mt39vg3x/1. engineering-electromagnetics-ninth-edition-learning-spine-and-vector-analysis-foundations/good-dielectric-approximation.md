---
title: "1.226 Good-Dielectric Approximation"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 395", "Page 396", "Page 397", "Page 398"]
related: ["conductivity-as-imaginary-permittivity", "microwave-absorption-and-penetration-in-water", "good-conductor-propagation-approximation", "lossless-dielectric-plane-wave-propagation"]
---

# 1.226 Good-Dielectric Approximation

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 395, Page 396, Page 397, Page 398

A medium is classified as a good dielectric when its loss tangent is much smaller than one: $\epsilon''/\epsilon'=\sigma/(\omega\epsilon')\ll1$. Under this condition, the propagation constant can be expanded with the binomial theorem. Substituting $x=-j\sigma/(\omega\epsilon')$ and exponent $n=1/2$ into $(1+x)^n$ separates the real and imaginary parts of $jk=\alpha+j\beta$. The resulting attenuation approximation is $\alpha\doteq(\sigma/2)\sqrt{\mu/\epsilon'}$. The phase constant is $\beta\doteq\omega\sqrt{\mu\epsilon'}[1+(1/8)(\sigma/(\omega\epsilon'))^2]$, and the correction term is often negligible, leaving $\beta\doteq\omega\sqrt{\mu\epsilon'}$. A similar expansion gives $\eta\doteq\sqrt{\mu/\epsilon'}[1+j\sigma/(2\omega\epsilon')]$. The source states that deviations from the exact formulas remain within a few percent when $\sigma/(\omega\epsilon')<0.1$. Example 11.5 applies these approximations to the 2.5 GHz water case with loss tangent $7/78=0.09$ and reproduces the exact values $\alpha=21\ \mathrm{Np/m}$, $\beta=464\ \mathrm{rad/m}$, and $\eta=43+j1.9\ \Omega$ to the precision justified by the input data.

## Page-Grounded Details

#### Page 395

Consider the Maxwell curl equation (23) which, using (42), becomes:
$$
\nabla\times H_{s}=j\omega(\epsilon^{\prime}-j\epsilon^{\prime\prime})E_{s}=\omega\epsilon^{\prime\prime}E_{s}+j\omega\epsilon^{\prime}E_{s}\qquad(53)
$$
This equation can be expressed in a more familiar way, in which conduction current is included:
$$
\nabla\times H_{s}=J_{s}+j\omega\epsilon E_{s}\qquad(54)
$$
We next use $J_{s}=\sigma\,E_{s}$, and interpret $\epsilon$ in (54) as $\epsilon^{\prime}$. The latter equation becomes:
$$
\nabla\times H_{s}=(\sigma+j\omega\epsilon^{\prime})E_{s}=J_{\sigma s}+J_{ds}\qquad(55)
$$
which we have expressed in terms of conduction current density, $J_{\sigma s}=\sigma\,E_{s}$, and displacement current density, $J_{ds}=j\omega\epsilon^{\prime}E_{s}$. Comparing Eqs. (53) and (55), we find that in a conductive medium:
$$
\epsilon^{\prime\prime}=\frac{\sigma}{\omega}\qquad(56)
$$
We next turn our attention to the case of a dielectric material in which the loss is very small. The criterion by which we should judge whether or not the loss is small is the magnitude of the loss tangent, $\epsilon^{\prime\prime}/\epsilon^{\prime}$. This parameter will have a direc

[Truncated for analysis]

#### Page 396

Figure11.2 The time-phase relationship between $J_{ds}$, $J_{\sigma s}$, $J_{s}$, and $E_{s}$. The tangent of $\theta$ is equal to $\sigma/\omega\epsilon'$, and $90^{\circ}$ - $\theta$ is the common power-factor angle, or the angle by which $J_{s}$ leads $E_{s}$.

loss tangent is $\epsilon''/\epsilon'\ll 1$, which we say identifies the medium as a good dielectric. Considering a conductive material, for which $\epsilon''=\sigma/\omega$, (43) becomes
$$
jk=j\omega\sqrt{\mu\epsilon'}\sqrt{1-j\frac{\sigma}{\omega\epsilon'}}\quad{(59)}
$$
We may expand the second radical using the binomial theorem
$$
(1+x)^{n}=1+nx+\frac{n(n-1)}{2!}x^{2}+\frac{n(n-1)(n-2)}{3!}x^{3}+\cdots
$$
where $|x|\ll 1$. We identify $x$ as $-j\sigma/\omega\epsilon'$ and $n$ as 1/2, and thus
$$
jk=j\omega\sqrt{\mu\epsilon'}\left[1-j\frac{\sigma}{2\omega\epsilon'}+\frac{1}{8}\left(\frac{\sigma}{\omega\epsilon'}\right)^{2}+\cdots\right]=\alpha+j\beta
$$
Now, for a good dielectric,
$$
\alpha=\mathcal{R}e(jk)\doteq j\omega\sqrt{\mu\epsilon'}\left(-j\frac{\sigma}{2\omega\epsilon'}\right)=\frac{\sigma}{2}\sqrt{\frac{\mu}{\epsilon'}}\quad{(60a)}
$$
and
$$
\beta=\mathcal{F}m(jk)\dote

[Truncated for analysis]

#### Page 397

the second term in (60b) is small enough, so
$$
 \beta\doteq\omega\sqrt{\mu e^{\prime}}\quad{(61)}
$$
Applying the binomial expansion to (48), we obtain, for a good dielectric
$$
 \eta\doteq\sqrt{\frac{\mu}{e^{\prime}}}\left[1-\frac{3}{8}\left(\frac{\sigma}{\omega e^{\prime}}\right)^{2}+j\frac{\sigma}{2\omega e^{\prime}}\right]\quad{(62a)}
$$
or
$$
 \eta\doteq\sqrt{\frac{\mu}{e^{\prime}}}\left(1+j\frac{\sigma}{2\omega e^{\prime}}\right)\quad{(62b)}
$$
The conditions under which these approximations can be used depend on the desired accuracy, measured by how much the results deviate from those given by the exact formulas, (44) and (45). Deviations of no more than a few percent occur if $\sigma/\omega e^{\prime}<0.1$.

#### Example 11.5

As a comparison, we repeat the computations of Example 11.4, using the approximation formulas (60a), (61), and (62b).

**Solution.** First, the loss tangent in this case is $e^{\prime\prime}/e^{\prime}=7/78=0.09$. Using (60), with $e^{\prime\prime}=\sigma/\omega$, we have
$$
 \alpha\doteq\frac{\omega e^{\prime\prime}}{2}\sqrt{\frac{\mu}{e^{\prime}}}=\frac{1}{2}(7\times 8.85\times 10^{12})(2\pi\times 2.5\times 10^{9})\frac{377}{\sqrt{78}}=21

[Truncated for analysis]

#### Page 398

D11.4. Given a nonmagnetic material having $\epsilon_{r}^{\prime}=3.2$ and $\sigma=1.5\times 10^{-4}$ S/m, find numerical values at 3 MHz for the (a) loss tangent; (b) attenuation constant; (c) phase constant; (d) intrinsic impedance.

Ans. (a) 0.28; (b) 0.016 Np/m; (c) 0.11 rad/m; (d) 207 $\angle 7.8^{\circ}$ $\Omega$

D11.5. Consider a material for which $\mu_{r}=1$, $\epsilon_{r}^{\prime}=2.5$, and the loss tangent is 0.12. If these three values are constant with frequency in the range $0.5$ MHz $\leq f\leq 100$ MHz, calculate: (a) $\sigma$ at 1 and 75 MHz; (b) $\lambda$ at 1 and 75 MHz; (c) $v_{p}$ at 1 and 75 MHz.

Ans. (a) $1.67\times 10^{-5}$ and $1.25\times 10^{-3}$ S/m; (b) 190 and 2.53 m; (c) $1.90\times 108$ m/s twice

#### 11.3 POYNTING'S THEOREM AND WAVE POWER

In order to find the power flow associated with an electromagnetic wave, it is necessary to develop a power theorem for the electromagnetic field known as the Poynting theorem. It was originally postulated in 1884 by an English physicist, John H. Poynting.

The development begins with one of Maxwell's curl equations, in which we assume that the medium may be conductive:
$$ \nabla\tim

[Truncated for analysis]

## Core Ideas

- The good-dielectric criterion is $\sigma/(\omega\epsilon')\ll1$.
- The derivation uses a binomial expansion of the propagation-constant radical.
- The approximate attenuation is $\alpha\doteq(\sigma/2)\sqrt{\mu/\epsilon'}$.
- The leading phase approximation is $\beta\doteq\omega\sqrt{\mu\epsilon'}$.
- The impedance approximation is $\eta\doteq\sqrt{\mu/\epsilon'}[1+j\sigma/(2\omega\epsilon')]$.
- A loss tangent below $0.1$ normally limits deviations to a few percent.
- Approximation accuracy should be judged relative to the precision of measured material parameters.

## Source Anchors

- Equation (59) writes the propagation constant with the factor $\sqrt{1-j\sigma/(\omega\epsilon')}$.
- Equations (60a) and (60b) give the good-dielectric approximations for $\alpha$ and $\beta$.
- Equation (61) drops the second-order phase correction.
- Equations (62a) and (62b) give successive intrinsic-impedance approximations.
- Example 11.5 uses a loss tangent of $7/78=0.09$ and obtains $\alpha=21\ \mathrm{Np/m}$, $\beta=464\ \mathrm{rad/m}$, and $\eta=43+j1.9\ \Omega$.
- Exercise D11.4 provides a test case with loss tangent $0.28$, $\alpha=0.016\ \mathrm{Np/m}$, $\beta=0.11\ \mathrm{rad/m}$, and $\eta=207\angle7.8^\circ\ \Omega$.

## Related Pages

- [[conductivity-as-imaginary-permittivity|Conductivity as Imaginary Permittivity]]
- [[microwave-absorption-and-penetration-in-water|Microwave Absorption and Penetration in Water]]
- [[good-conductor-propagation-approximation|Good-Conductor Propagation Approximation]]
- [[lossless-dielectric-plane-wave-propagation|Lossless Dielectric Plane-Wave Propagation]]

## Concept Dependencies

- derives-from: [[lossless-dielectric-plane-wave-propagation|Lossless Dielectric Plane-Wave Propagation]]
- applies-to: [[microwave-absorption-and-penetration-in-water|Microwave Absorption and Penetration in Water]]
- contrasts-with: [[good-conductor-propagation-approximation|Good-Conductor Propagation Approximation]]
