---
title: "1.82 Series and Parallel Multiple-Dielectric Capacitors"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 162", "Page 163", "Page 164", "Section 6.3.3: Capacitors with Multiple Dielectrics", "Figure 6.3"]
related: ["refraction-of-fields-at-a-dielectric-boundary", "parallel-plate-capacitance", "coaxial-and-spherical-capacitor-geometries"]
---

# 1.82 Series and Parallel Multiple-Dielectric Capacitors

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 162, Page 163, Page 164, Section 6.3.3: Capacitors with Multiple Dielectrics, Figure 6.3

Multiple dielectric regions alter capacitance according to how their interfaces are oriented relative to the electric field. For a coated isolated sphere, spherical symmetry leaves $D_r=Q/(4\pi r^2)$ unchanged across the dielectric boundary, while $E_r=D_r/\epsilon$ changes by region. The total voltage is the sum of radial line integrals through each material. For a parallel-plate capacitor whose dielectric interface is parallel to the plates, the field is normal to the interface and $D_N$ is continuous. Each layer contributes a voltage drop $V_i=Qd_i/(\epsilon_iS)$, producing
$$
C=\frac{1}{d_1/(\epsilon_1S)+d_2/(\epsilon_2S)}
$$
 equivalent to capacitors in series. If the dielectric boundary is normal to the plates, both regions share the same voltage and tangential electric field. Their charges add, giving
$$
C=\frac{\epsilon_1S_1+\epsilon_2S_2}{d}=C_1+C_2
$$
 The source also states that inserting a negligible-thickness conducting plane at a parallel dielectric interface leaves capacitance unchanged, while replacing a finite dielectric volume with a conductor increases capacitance.

## Page-Grounded Details

#### Page 162

#### 6.3.3 Capacitors with Multiple Dielectrics

Suppose the sphere in the previous example were to be coated with a different dielectric layer, for which $\epsilon=\epsilon_{1}$, extending from $r=a$ to $r=r_{1}$. As the charge is still $Q$, the electric flux density is unaffected by the dielectric layer, but the electric field will evaluate differently in the two media. We have:
$$
\begin{align*}D_{r}&=\frac{Q}{4\pi r^{2}}\quad(a<r<\infty)\\ E_{r}&=\frac{Q}{4\pi\epsilon_{1} r^{2}}\quad(a<r<r_{1})\\&=\frac{Q}{4\pi\epsilon_{0} r^{2}}\quad(r_{1}<r)\end{align*}
$$
The potential difference between the conductor and infinity is now:
$$
\begin{align*}V_{0}&=V_{a}-V_{\infty}=-\int_{r_{1}}^{a}^{a}\frac{Q dr}{4\pi\epsilon_{1} r^{2}}-\int_{\infty}^{r_{1}}\frac{Q dr}{4\pi\epsilon_{0} r^{2}}\\&=\frac{Q}{4\pi}\left[\frac{1}{\epsilon_{1}}\left(\frac{1}{a}-\frac{1}{r_{1}}\right)+\frac{1}{\epsilon_{0} r_{1}}\right]\end{align*}
$$
Therefore, the capacitance is
$$
C=\frac{Q}{V_{0}}=\frac{4\pi}{\frac{1}{\epsilon_{1}}\left(\frac{1}{a}-\frac{1}{r_{1}}\right)+\frac{1}{\epsilon_{0} r_{1}}}
$$
In order to look at the problem of multiple dielectrics a little more thoroughly, consider a paral

[Truncated for analysis]

#### Page 163

where $C_{1}=\epsilon_{1}S/d_{1}$ and $C_{2}=\epsilon_{2}S/d_{2}$. This is the correct result, but we can obtain it using less intuition and a more basic approach.

Because the capacitance definition, $C=Q/V_{0}$, involves a charge and a voltage, we may assume either and then find the other in terms of it. The capacitance is not a function of either, but only of the dielectrics and the geometry. Suppose we assume a potential difference $V_{0}$ between the plates. The electric field intensities in the two regions, $E_{2}$ and $E_{1}$, are both uniform, and $V_{0}=E_{1}d_{1}+E_{2}d_{2}$. At the dielectric interface, E is normal, and our boundary condition, Eq. (35) in Chapter 5, tells us that $D_{N1}=D_{N2}$, or $\epsilon_{1}E_{1}=\epsilon_{2}E_{2}$. This assumes (correctly) that there is no surface charge at the interface. Eliminating $E_{2}$ in our $V_{0}$ relation, we have
$$
E_{1}=\frac{V_{0}}{d_{1}+d_{2}(\epsilon_{1}/\epsilon_{2})}
$$
and the surface charge density on the lower plate therefore has the magnitude
$$
\rho_{S1}=D_{1}=\epsilon_{1}E_{1}=\frac{V_{0}}{\frac{d_{1}}{\epsilon_{1}}+\frac{d_{2}}{\epsilon_{2}}}
$$
Because $D_{1}=D_{2}$, the magnitu

[Truncated for analysis]

#### Page 164

If the dielectric boundary were placed normal to the two conducting plates and the dielectrics occupied areas of $S_{1}$ and $S_{2}$, then an assumed potential difference $V_{0}$ would produce field strengths $E_{1}=E_{2}=V_{0}/d$. These are tangential fields at the interface, and they must be equal. Then we may find in succession $D_{1}$, $D_{2}$, $\rho S_{1}$, $\rho S_{2}$, and $Q$, obtaining a capacitance
$$
C = \frac{\epsilon_{1} S_{1} + \epsilon_{2} S_{2}}{d} = C_{1} + C_{2} \quad{(10)}
$$
as we expect.

D6.2. Determine the capacitance of: (a) a 1-ft length of 35B/U coaxial cable, which has an inner conductor 0.1045 in. in diameter, a polyethylene dielectric ($\epsilon_{r} = 2.26$ from Table C.1), and an outer conductor that has an inner diameter of 0.680 in.; (b) a conducting sphere of radius 2.5 mm, covered with a polyethylene layer 2 mm thick, surrounded by a conducting sphere of radius 4.5 mm; (c) two rectangular conducting plates, 1 cm by 4 cm, with negligible thickness, between which are three sheets of dielectric, each 1 cm by 4 cm, and 0.1 mm thick, having dielectric constants of 1.5, 2.5, and 6.

Ans. (a) 20.5 pF; (b) 1.41 pF; (c) 28.7 pF

#### 6

[Truncated for analysis]

## Core Ideas

- Layered dielectrics along the field direction behave as series capacitors.
- Side-by-side dielectrics transverse to the field direction behave as parallel capacitors.
- Normal $\mathbf D$ continuity controls the series-layer derivation.
- Tangential $\mathbf E$ continuity controls the side-by-side derivation.
- Voltage drops add through serial dielectric layers.
- Replacing dielectric volume with a conducting body increases capacitance.

## Source Anchors

- The coated-sphere example uses $D_r=Q/(4\pi r^2)$ in both dielectric regions.
- The coated-sphere voltage contains separate integrals weighted by $1/\epsilon_1$ and $1/\epsilon_0$.
- Figure 6.3 shows a parallel-plate capacitor whose dielectric interface is parallel to the plates.
- Equation (9):
$$
C=\frac{1}{d_1/(\epsilon_1S)+d_2/(\epsilon_2S)}
$$
- Equation (10):
$$
C=(\epsilon_1S_1+\epsilon_2S_2)/d=C_1+C_2
$$
- Visual opportunity S1.P162.F1: recreate Figure 6.3 with field, layer thicknesses, voltage drops, and the equivalent series circuit.

## Related Pages

- [[refraction-of-fields-at-a-dielectric-boundary|Refraction of Fields at a Dielectric Boundary]]
- [[parallel-plate-capacitance|Parallel-Plate Capacitance]]
- [[coaxial-and-spherical-capacitor-geometries|Coaxial and Spherical Capacitor Geometries]]

## Concept Dependencies

- derives-from: [[parallel-plate-capacitance|Parallel-Plate Capacitance]]
- depends-on: [[refraction-of-fields-at-a-dielectric-boundary|Refraction of Fields at a Dielectric Boundary]]
- applies-to: [[coaxial-and-spherical-capacitor-geometries|Coaxial and Spherical Capacitor Geometries]]
