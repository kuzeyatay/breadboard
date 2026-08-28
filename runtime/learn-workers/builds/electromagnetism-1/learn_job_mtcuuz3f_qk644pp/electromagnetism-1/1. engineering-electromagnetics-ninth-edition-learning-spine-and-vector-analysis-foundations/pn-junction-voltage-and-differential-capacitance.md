---
title: "1.97 pn Junction Voltage and Differential Capacitance"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 185", "Page 186"]
related: ["one-dimensional-poisson-solution-for-a-pn-junction", "potential-to-charge-capacitance-workflow", "capacitor-geometry-and-dielectric-design-problems"]
---

# 1.97 pn Junction Voltage and Differential Capacitance

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 185, Page 186

The smooth pn-junction solution links depletion width, built-in voltage, charge, and differential capacitance. The potential becomes nearly constant about $4a$ to $5a$ from the junction. Taking the difference between the asymptotic potentials gives
$$
V_0=\frac{2\pi\rho_{v0}a^2}{\epsilon}
$$
 Integrating the positive charge density over the n side and multiplying by junction area $S$ gives
$$
Q=2\rho_{v0}aS
$$
 Eliminating $a$ yields
$$
Q=S\sqrt{\frac{2\rho_{v0}\epsilon V_0}{\pi}}
$$
 Because charge is not proportional to voltage, the junction capacitance is not defined as a constant ratio $Q/V_0$. Using the circuit relation $I=dQ/dt=C\,dV_0/dt$ gives the differential definition $C=dQ/dV_0$. Differentiation produces
$$
C=S\sqrt{\frac{\rho_{v0}\epsilon}{2\pi V_0}}=\frac{\epsilon S}{2\pi a}
$$
 Thus, capacitance decreases as $V_0^{-1/2}$. The second form resembles a parallel-plate capacitor with an effective separation $2\pi a$.

## Page-Grounded Details

#### Page 185

subject to the charge distribution assumed above,
$$
\frac{d^{2}V}{dx^{2}}=-\frac{2\rho_{v0}}{\epsilon}\operatorname{sech}\frac{x}{a}\tanh\frac{x}{a}
$$
in this one-dimensional problem in which variations with y and z are not present. We integrate once,
$$
\frac{dV}{dx}=\frac{2\rho_{v0}a}{\epsilon}\operatorname{sech}\frac{x}{a}+C_{1}
$$
and obtain the electric field intensity,
$$
E_{x}=-\frac{2\rho_{v0}a}{\epsilon}\operatorname{sech}\frac{x}{a}-C_{1}
$$
To evaluate the constant of integration $C_{1}$, we note that no net charge density and no fields can exist far from the junction. Thus, as $x\rightarrow\pm\infty$, $E_{x}$ must approach zero. Therefore $C_{1}=0$, and
$$
E_{x}=-\frac{2\rho_{v0}a}{\epsilon}\operatorname{sech}\frac{x}{a}\quad{(45)}
$$
Integrating again,
$$
V=\frac{4\rho_{v0}a^{2}}{\epsilon}\tan^{-1}\,e^{x/a}+C_{2}
$$
The zero reference of potential is arbitrarily set at the center of the junction, $x=0$,
$$
0=\frac{4\rho_{v0}a^{2}}{\epsilon}\frac{\pi}{4}+C_{2}
$$
and finally,
$$
V=\frac{4\rho_{v0}a^{2}}{\epsilon}\left(\tan^{-1}\,e^{x/a}-\frac{\pi}{4}\right)\quad{(46)}
$$
Figure 6.12 shows the charge distribution (a), electric field intensity (b

[Truncated for analysis]

#### Page 186

Because the total charge is a function of the potential difference, we have to be careful in defining a capacitance. Thinking in "circuit" terms for a moment,
$$
I = \frac{dQ}{dt} = C \frac{dV_{0}}{dt}
$$
and thus
$$
C = \frac{dQ}{dV_{0}}
$$
By differentiating Eq. (48), we therefore have the capacitance
$$
C = \sqrt{\frac{\rho_{v0} \epsilon}{2\pi V_{0}}} S = \frac{\epsilon S}{2\pi a}
$$
(49)

The first form of Eq. (49) shows that the capacitance varies inversely as the square root of the voltage. That is, a higher voltage causes a greater separation of the charge layers and a smaller capacitance. The second form is interesting in that it indicates that we may think of the junction as a parallel-plate capacitor with a "plate" separation of $2\pi a$. In view of the dimensions of the region in which the charge is concentrated, this is a logical result.

D6.7. In the neighborhood of a certain semiconductor junction, the volume charge density is given by $\rho_{v} = 750$ sech $10^{6}\pi x\tanh 10^{6}\pi x C/m^{3}$. The dielectric constant of the semiconductor material is 10 and the junction area is $2\times 10^{-7} m^{2}$. Find: (a) $V_{0}$; (b) C; (c) E at the junction.

[Truncated for analysis]

## Core Ideas

- The junction potential is nearly constant beyond about $4a$ to $5a$.
- The total voltage is $V_0=2\pi\rho_{v0}a^2/\epsilon$.
- The positive-side charge is $Q=2\rho_{v0}aS$.
- Eliminating $a$ gives $Q\propto\sqrt{V_0}$.
- Junction capacitance must be defined as $dQ/dV_0$.
- The capacitance varies as $V_0^{-1/2}$.
- The effective parallel-plate separation is $2\pi a$.

## Source Anchors

- Equation (47) gives the asymptotic potential difference.
- The positive charge integral gives $Q=2\rho_{v0}aS$.
- Equation (48) gives $Q=S\sqrt{2\rho_{v0}\epsilon V_0/\pi}$.
- The source derives $C=dQ/dV_0$ from $I=dQ/dt$.
- Equation (49) gives both capacitance forms.
- Problem D6.7 gives a numerical junction with answers $V_0=2.70\ \mathrm{V}$, $C=8.85\ \mathrm{pF}$, and $E=2.70\ \mathrm{MV/m}$.

## Related Pages

- [[one-dimensional-poisson-solution-for-a-pn-junction|One-Dimensional Poisson Solution for a pn Junction]]
- [[potential-to-charge-capacitance-workflow|Potential-to-Charge Capacitance Workflow]]
- [[capacitor-geometry-and-dielectric-design-problems|Capacitor Geometry and Dielectric Design Problems]]

## Concept Dependencies

- derives-from: [[one-dimensional-poisson-solution-for-a-pn-junction|One-Dimensional Poisson Solution for a pn Junction]]
- related: [[potential-to-charge-capacitance-workflow|Potential-to-Charge Capacitance Workflow]]
