---
title: "1.34 Electric Field Intensity as Force per Unit Charge"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 41", "Section: 2.2 Electric Field Intensity", "Section: 2.2.1 Electric Field Definition for a Point Charge", "Page 42"]
related: ["coulombs-experimental-inverse-square-law", "point-charge-electric-field-at-the-origin-and-general-locations", "electric-field-superposition-from-multiple-point-charges"]
---

# 1.34 Electric Field Intensity as Force per Unit Charge

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 41, Section: 2.2 Electric Field Intensity, Section: 2.2.1 Electric Field Definition for a Point Charge, Page 42

Electric field intensity converts the interaction between charges into a field defined at every observation point. A source charge creates the field, while a small positive test charge probes it. If the test charge experiences force $\mathbf{F}_t$, the field is defined by
$$
\mathbf{E}=\frac{\mathbf{F}_t}{Q_t}
$$
 The field therefore gives the force that would act on a unit positive test charge and has both magnitude and direction. It is a point function because its value depends on location. The test charge's own field is excluded from the field being evaluated. Forces on extended charged objects cannot generally be represented by a single point evaluation; their contributions must be summed over the charge distribution, later through a superposition integral. The source gives the equivalent units $\mathrm{N/C}$ and $\mathrm{V/m}$.

## Page-Grounded Details

#### Page 41

Coulomb's law is linear, for if we multiply $Q_{1}$ by a factor $n$, the force on $Q_{2}$ is also multiplied by the same factor $n$. It is also true that the force on a charge in the presence of several other charges is the sum of the forces on that charge arising from each of the other charges acting alone.

D2.1. A charge $Q_{A}=-20\mu C$ is located at $A(-6,4,7)$, and a charge $Q_{B}=50\mu C$ is at $B(5,8,-2)$ in free space. If distances are given in meters, find: (a) $R_{AB}$; (b) $R_{AB}$. Determine the vector force exerted on $Q_{A}$ by $Q_{B}$ if $\epsilon_{0}=(c)10^{-9}/(36\pi)F/m$; (d) $8.854\times10^{-12}F/m$.

Ans. (a) $11a_{x}+4a_{y}-9a_{z}m$; (b) 14.76 m; (c) $30.76a_{x}+11.184a_{y}-25.16a_{z}mN$; (d) $30.72a_{x}+11.169a_{y}-25.13a_{z}mN$

#### 2.2 ELECTRIC FIELD INTENSITY

Here, we introduce the first of several field quantities that we will use throughout our study. The electric field intensity gives the magnitude and direction of electrostatic force that would be applied to a point charge of unit magnitude that resides in the field, and as a function of its location. Emphasized here is the notion of the force acting at a point, and

[Truncated for analysis]

#### Page 42

The units of E would be in force per unit charge (newtons per coulomb). Again anticipating a new dimensional quantity, the volt (V), having the label of joules per coulomb (J/C), or newton-meters per coulomb (N*m/C), we measure electric field intensity in the practical units of volts per meter (V/m).

Most of the subscripts in (6) are now removed, reserving the right to use them again any time there is a possibility of misunderstanding. The electric field of a single point charge becomes:
$$
E = \frac{Q}{4\pi \epsilon_{0} R^{2}} a_{R} \quad{(8)}
$$
We remember that R is the magnitude of the vector R, the directed line segment from the point at which the point charge Q is located to the point at which E is desired, and $a_{R}$ is a unit vector in the R direction.^3

We arbitrarily locate $Q_{1}$ at the center of a spherical coordinate system. The unit vector $a_{R}$ then becomes the radial unit vector $a_{r}$, and R is r. Hence
$$
E = \frac{Q_{1}}{4\pi \epsilon_{0} r^{2}} a_{r} \quad{(9)}
$$
The field has a single radial component, and its inverse-square-law relationship is quite obvious.

#### 2.2.2 Fields Associated with Charges at General Locations

For a charge that

[Truncated for analysis]

## Core Ideas

- A source charge establishes an electric field throughout surrounding space.
- A test charge is used to define the force experienced at a point.
- The defining relation is $\mathbf{E}=\mathbf{F}_t/Q_t$.
- The direction is the force direction on a positive test charge.
- Electric field intensity is a vector point function.
- The test charge's self-field is excluded.
- The units $\mathrm{N/C}$ and $\mathrm{V/m}$ are equivalent.
- Extended charge distributions require summation or integration over contributions.

## Source Anchors

- Section 2.2 defines electric field intensity as electrostatic force per unit charge at a location.
- Equation (7) states $\mathbf{E}=\mathbf{F}_t/Q_t$.
- The text interprets the field as the vector force acting on a unit positive test charge.
- The source explicitly excludes the electric field arising from the test charge itself.
- Page 42 identifies the practical field unit as volts per meter.
- The introduction to Section 2.2 states that forces on charge distributions require a superposition integral.

## Related Pages

- [[coulombs-experimental-inverse-square-law|Coulomb's Experimental Inverse-Square Law]]
- [[point-charge-electric-field-at-the-origin-and-general-locations|Point-Charge Electric Field at the Origin and General Locations]]
- [[electric-field-superposition-from-multiple-point-charges|Electric Field Superposition from Multiple Point Charges]]

## Concept Dependencies

- depends-on: [[coulombs-experimental-inverse-square-law|Coulomb's Experimental Inverse-Square Law]]
