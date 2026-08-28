---
title: "1.80 Electric Energy Stored in a Capacitor"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 160", "Page 161", "Equation (4)", "Problem D6.1"]
related: ["parallel-plate-capacitance", "capacitance-as-a-charge-to-potential-ratio", "curved-dielectric-interface-field-tasks"]
---

# 1.80 Electric Energy Stored in a Capacitor

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 160, Page 161, Equation (4), Problem D6.1

The energy of a capacitor can be calculated by integrating electric-field energy density throughout the dielectric. For a homogeneous linear dielectric, the source uses $w_E=\tfrac12\epsilon E^2$. In the uniform field of a parallel-plate capacitor, integrating this density over volume $Sd$ gives a result that can be rewritten using $C=\epsilon S/d$, $V_0=Ed$, and $Q=CV_0$. The equivalent forms are
$$
W_E=\frac12CV_0^2=\frac12QV_0=\frac12\frac{Q^2}{C}
$$
 Each form is useful under a different constraint. At fixed voltage, increasing capacitance increases stored energy. At fixed charge, increasing capacitance decreases stored energy. The source explicitly notes that when the potential difference is fixed, increasing the dielectric constant increases the stored energy because capacitance rises with permittivity. Diagnostic problem D6.1 reverses these formulas to infer relative permittivity from total energy, energy density, or the pair $E$ and $\rho_S$.

## Page-Grounded Details

#### Page 160

distribution are then almost uniform at all points not adjacent to the edges, and this latter region contributes only a small percentage of the total capacitance, allowing us to write the familiar result
$$
\begin{array}[]{l}Q=\rho_{S}S\\ V_{0}=\frac{\rho_{S}}{\epsilon}d\end{array}\quad{(3)}
$$
More rigorously, we might consider Eq. (3) as the capacitance of a portion of the infinite-plane arrangement having a surface area $S$. Methods of calculating the effect of the unknown and nonuniform distribution near the edges must wait until we are able to solve more complicated potential problems.

#### Example 6.1

Calculate the capacitance of a parallel-plate capacitor having a mica dielectric, $\epsilon_{r}=6$, a plate area of $10\text{ in.}^{2}$, and a separation of 0.01 in.

Solution. We find that
$$
\begin{array}[]{l}S=10\times 0.0254^{2}=6.45\times 10^{-3}m^{2}\\ d=0.01\times 0.0254=2.54\times 10^{-4}m\end{array}
$$
and therefore
$$
C=\frac{6\times 8.854\times 10^{-12}\times 6.45\times 10^{-3}}{2.54\times 10^{-4}}=1.349\text{nF}
$$
A large plate area is obtained in capacitors of small physical dimensions by stacking smaller plates in 50- or 100-decker sandwiches, or by

[Truncated for analysis]

#### Page 161

D6.1. Find the relative permittivity of the dielectric material present in a parallel-plate capacitor if: (a) S=0.12 $m^{2}$, d=80 $\mu m$, $V_{0}$=12 V, and the capacitor contains 1 $\mu J$ of energy; (b) the stored energy density is 100 $J/m^{3}$, $V_{0}$=200 V, and d=45 $\mu m$; (c) E=200 kV/m and $\rho_{S}$=20 $\mu C/m^{2}$.

Ans. (a) 1.05; (b) 1.14; (c) 11.3

#### 6.3 SEVERAL CAPACITANCE EXAMPLES

The methods just presented can be applied without much difficulty to other geometries in the other coordinate systems. A few examples follow.

6.3.1 Coaxial Cable

As a first brief example, we choose a coaxial cable or coaxial capacitor of inner radius a, outer radius b, and length L. No great derivational struggle is required, because the potential difference is given as Eq. (11) in Section 4.3, and we find the capacitance very simply by dividing this by the total charge $\rho_{L}L$ in the length L. Thus,
$$
C=\frac{2\pi\epsilon L}{\ln(b/a)}
$$
(5)

6.3.2 Spherical Capacitor

Next we consider a spherical capacitor formed of two concentric spherical conducting shells of radius a and b, b > a. The expression for the electric field was obtained previously by Gauss

[Truncated for analysis]

## Core Ideas

- Electric energy density in a linear dielectric is $w_E=\tfrac12\epsilon E^2$.
- Total energy is obtained by integrating energy density over the dielectric volume.
- $W_E=\tfrac12CV_0^2$ is convenient when voltage is specified.
- $W_E=\tfrac12Q^2/C$ is convenient when charge is specified.
- At fixed voltage, higher permittivity increases stored energy.
- Energy measurements can be used to infer dielectric permittivity.

## Source Anchors

- The source integrates $\tfrac12\epsilon E^2$ over the parallel-plate volume.
- Equation (4):
$$
W_E=\frac12CV_0^2=\frac12QV_0=\frac12\frac{Q^2}{C}
$$
- The text states that stored energy at fixed potential difference increases with dielectric constant.
- D6.1 asks for relative permittivity using total energy, energy density, and field plus surface charge data.
- D6.1 reports answers 1.05, 1.14, and 11.3.

## Related Pages

- [[parallel-plate-capacitance|Parallel-Plate Capacitance]]
- [[capacitance-as-a-charge-to-potential-ratio|Capacitance as a Charge-to-Potential Ratio]]
- [[curved-dielectric-interface-field-tasks|Curved Dielectric Interface Field Tasks]]

## Concept Dependencies

- derives-from: [[parallel-plate-capacitance|Parallel-Plate Capacitance]]
- depends-on: [[capacitance-as-a-charge-to-potential-ratio|Capacitance as a Charge-to-Potential Ratio]]
