---
title: "1.78 Capacitance as a Charge-to-Potential Ratio"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 157", "Page 158", "Section 6.1: Capacitance Defined", "Figure 6.1"]
related: ["parallel-plate-capacitance", "electric-energy-stored-in-a-capacitor", "coaxial-and-spherical-capacitor-geometries"]
---

# 1.78 Capacitance as a Charge-to-Potential Ratio

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 157, Page 158, Section 6.1: Capacitance Defined, Figure 6.1

Capacitance measures the ability of a conductor arrangement to store electric charge, electric flux, and field energy. For two conductors embedded in a homogeneous dielectric, one conductor carries $+Q$ and the other carries $-Q$. Their surfaces are equipotentials, the electric field is normal to each surface, and flux runs from the positive conductor to the negative conductor. If the positive conductor is at potential $V_0$ relative to the negative conductor, capacitance is defined by
$$
C=\frac{Q}{V_0}
$$
 Charge can be calculated by integrating $\epsilon\mathbf E$ over a conductor surface, while voltage is obtained from a line integral of $\mathbf E$. Scaling the conductor charge by a factor scales $\mathbf D$, $\mathbf E$, and $V_0$ by the same factor, so their ratio remains unchanged. Capacitance therefore depends only on conductor geometry and dielectric permittivity for a linear homogeneous system. Its SI unit is the farad, equal to one coulomb per volt, with practical values commonly expressed in microfarads, nanofarads, or picofarads. Figure 6.1 provides the defining two-conductor geometry.

## Page-Grounded Details

#### Page 157

### Capacitance

Capacitance measures the capability of energy storage in electrical devices. It can be designed for a specific purpose, or it may exist as an unavoidable by-product of the device structure that one must live with. Understanding capacitance and its impact on device or system operation is critical in every aspect of electrical engineering.

A capacitor is a device that stores energy; energy thus stored can either be associated with accumulated charge or it can be related to the stored electric field, as was discussed in Section 4.8. In fact, one can think of a capacitor as a device that stores electric flux, in a similar way that an inductor-an analogous device-stores magnetic flux (or ultimately magnetic field energy). We will explore this in Chapter 8. A primary goal in this chapter is to present the methods for calculating capacitance for a number of cases, including transmission line geometries, and to be able to make judgments on how capacitance will be altered by changes in materials or their configuration.

#### 6.1 CAPACITANCE DEFINED

Consider two conductors embedded in a homogeneous dielectric (Figure 6.1). Conductor $M_{2}$ carries a total positive charg

[Truncated for analysis]

#### Page 158

Figure 6.1 Two oppositely charged conductors $M_{1}$ and $M_{2}$ surrounded by a uniform dielectric. The ratio of the magnitude of the charge on either conductor to the magnitude of the potential difference between them is the capacitance C.

charge on either conductor to the magnitude of the potential difference between conductors,
$$
C = \frac{Q}{V_{0}} \quad{(1)}
$$
In general terms, we determine $Q$ by a surface integral over the positive conductors, and we find $V_{0}$ by carrying a unit positive charge from the negative to the positive surface,
$$
C = \frac{\oint_{S} \epsilon \mathbf{E} \cdot d\mathbf{S}}{-\int_{-\infty}^{+\infty} \mathbf{E} \cdot d\mathbf{L}} \quad{(2)}
$$
The capacitance is independent of the potential and total charge, for their ratio is constant. If the charge density is increased by a factor of $N$, Gauss's law indicates that the electric flux density or electric field intensity also increases by $N$, as does the potential difference. The capacitance is a function only of the physical dimensions of the system of conductors and of the permittivity of the homogeneous dielectric.

Capacitance is measured in farads (F), where a farad is defin

[Truncated for analysis]

## Core Ideas

- A two-conductor capacitor carries equal and opposite total charges.
- Conductor surfaces are equipotentials and the electric field meets them normally.
- Capacitance is defined as $C=Q/V_0$.
- Charge is obtained from a surface integral of electric flux density.
- Voltage is obtained from a line integral of electric field intensity.
- Capacitance depends on geometry and permittivity, not the chosen $Q$ or $V_0$.

## Source Anchors

- Figure 6.1 shows conductors $M_1$ and $M_2$ carrying opposite charges in a uniform dielectric.
- Equation (1): $C=Q/V_0$.
- Equation (2) expresses capacitance using a surface integral of $\epsilon\mathbf E$ and a line integral of $\mathbf E$.
- The source states that increasing charge density by a factor $N$ also increases field and voltage by $N$.
- One farad is one coulomb per volt.
- Visual opportunity S1.P158.F1: recreate Figure 6.1 with charge, flux direction, equipotential conductors, and the $Q/V_0$ ratio.

## Related Pages

- [[parallel-plate-capacitance|Parallel-Plate Capacitance]]
- [[electric-energy-stored-in-a-capacitor|Electric Energy Stored in a Capacitor]]
- [[coaxial-and-spherical-capacitor-geometries|Coaxial and Spherical Capacitor Geometries]]

## Concept Dependencies

- enables: [[parallel-plate-capacitance|Parallel-Plate Capacitance]]
