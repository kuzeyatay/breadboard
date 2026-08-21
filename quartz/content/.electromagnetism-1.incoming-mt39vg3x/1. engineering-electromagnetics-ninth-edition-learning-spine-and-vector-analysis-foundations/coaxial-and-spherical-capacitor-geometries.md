---
title: "1.81 Coaxial and Spherical Capacitor Geometries"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 161", "Section 6.3.1: Coaxial Cable", "Section 6.3.2: Spherical Capacitor"]
related: ["capacitance-as-a-charge-to-potential-ratio", "series-and-parallel-multiple-dielectric-capacitors", "conduction-resistance-in-nonuniform-geometries"]
---

# 1.81 Coaxial and Spherical Capacitor Geometries

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 161, Section 6.3.1: Coaxial Cable, Section 6.3.2: Spherical Capacitor

Capacitance for symmetric geometries follows from the same charge-to-potential definition once the electric field and voltage are known. A coaxial capacitor with inner radius $a$, outer radius $b$, length $L$, and dielectric permittivity $\epsilon$ has
$$
C=\frac{2\pi\epsilon L}{\ln(b/a)}
$$
 For concentric spherical conductors of radii $a$ and $b$, Gauss's law gives $E_r=Q/(4\pi\epsilon r^2)$. Integrating this radial field produces $V_{ab}=Q(1/a-1/b)/(4\pi\epsilon)$, so
$$
C=\frac{4\pi\epsilon}{1/a-1/b}
$$
 Sending the outer radius to infinity gives the capacitance of an isolated spherical conductor, $C=4\pi\epsilon a$. The source notes that a free-space sphere of diameter 1 cm has capacitance $0.556$ pF. These derivations illustrate a durable method: exploit symmetry to obtain $\mathbf D$ or $\mathbf E$, integrate the field to find voltage, and divide charge by voltage.

## Page-Grounded Details

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

- Coaxial capacitance depends logarithmically on the radius ratio.
- Spherical capacitance follows from the inverse-square radial field.
- The concentric-sphere voltage is proportional to $1/a-1/b$.
- An isolated sphere is obtained by taking $b\to\infty$.
- All formulas scale linearly with dielectric permittivity.
- The derivation sequence is field, voltage, then charge-to-voltage ratio.

## Source Anchors

- Equation (5): $C=2\pi\epsilon L/\ln(b/a)$ for a coaxial cable.
- The spherical field is $E_r=Q/(4\pi\epsilon r^2)$.
- The spherical potential difference is $V_{ab}=Q(1/a-1/b)/(4\pi\epsilon)$.
- Equation (6): $C=4\pi\epsilon/(1/a-1/b)$.
- Equation (7): $C=4\pi\epsilon a$ for an isolated sphere.
- A 1 cm diameter sphere in free space has $C=0.556$ pF.

## Related Pages

- [[capacitance-as-a-charge-to-potential-ratio|Capacitance as a Charge-to-Potential Ratio]]
- [[series-and-parallel-multiple-dielectric-capacitors|Series and Parallel Multiple-Dielectric Capacitors]]
- [[conduction-resistance-in-nonuniform-geometries|Conduction Resistance in Nonuniform Geometries]]

## Concept Dependencies

- applies-to: [[capacitance-as-a-charge-to-potential-ratio|Capacitance as a Charge-to-Potential Ratio]]
- related: [[conduction-resistance-in-nonuniform-geometries|Conduction Resistance in Nonuniform Geometries]]
