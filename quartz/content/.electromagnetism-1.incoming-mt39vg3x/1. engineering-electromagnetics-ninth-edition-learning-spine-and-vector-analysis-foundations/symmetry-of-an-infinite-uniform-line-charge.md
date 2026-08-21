---
title: "1.42 Symmetry of an Infinite Uniform Line Charge"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 48", "Page 49", "Section: 2.4 Field of a Line Charge", "Section: 2.4.1 Setting Up the Problem: The Importance of Symmetry"]
related: ["derivation-and-distance-scaling-of-the-infinite-line-field", "off-axis-infinite-line-charge", "field-of-an-infinite-uniform-sheet"]
---

# 1.42 Symmetry of an Infinite Uniform Line Charge

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 48, Page 49, Section: 2.4 Field of a Line Charge, Section: 2.4.1 Setting Up the Problem: The Importance of Symmetry

Before integrating the field of an infinite uniform line charge, symmetry determines its possible coordinate dependence and components. A line extending along the entire $z$ axis looks unchanged under rotation about that axis, so azimuthal symmetry eliminates dependence on $\phi$. Translating the observation point along $z$ also leaves the source unchanged, so axial symmetry eliminates dependence on $z$. Changing radial distance $\rho$ does change the geometry, so the field can depend on $\rho$. Each source element produces radial and axial differential components, but elements located equal distances above and below the observation plane produce equal and opposite axial contributions. No azimuthal contribution is produced. Consequently, the total field has only a radial component and can be written as $\mathbf{E}=E_\rho(\rho)\mathbf{a}_\rho$. This symmetry analysis predicts the final field structure before any calculus is performed.

## Page-Grounded Details

#### Page 48

#### 2.4 FIELD OF A LINE CHARGE

Up to this point we have considered two types of charge distribution, the point charge and continuous charge distributed throughout a volume with a density $\rho_{v}$ C/m^3. We now con-sider a filamentlike distribution of volume charge density, such as a charged conductor of very small radius. It is convenient to treat the charge as a line charge of density $\rho_{L}$ C/m.

Consider a straight-line charge extending along the $z$ axis in a cylindrical coord-inate system from $-\infty$ to $\infty$, as shown in Figure 2.6. We will find the electric field intensity $\mathbf{E}$ at any and every point resulting from a _uniform_ line charge density $\rho_{L}$.

#### 2.4.1 Setting Up the Problem: The Importance of Symmetry

Symmetry should always be considered first in order to determine two specific fac-tors: (1) with which coordinates the field does _not_ vary, and (2) which components of the field are _not_ present. The answers to these questions then tell us which compo-nents are present and with which coordinates they _do_ vary.

Referring to Figure 2.6, we realize that as we move around the line charge, varying $\phi$ while keeping $

[Truncated for analysis]

#### Page 49

If we maintain $\phi$ and $z$ constant and vary $\rho$, the problem changes, and Coulomb's law leads us to expect the field to become weaker as $\rho$ increases. Hence, by a process of elimination we are led to the fact that the field varies only with $\rho$.

Now, which components are present? Each incremental length of line charge acts as a point charge and produces an incremental contribution to the electric field intensity that is directed away from the bit of charge (assuming a positive line charge). No element of charge produces a $\phi$ component of electric intensity; $E_{\phi}$ is zero. However, each element does produce an $E_{\rho}$ and an $E_{z}$ component, but the contribution to $E_{z}$ by elements of charge that are equal distances above and below the point at which we are determining the field will cancel. Therefore only an $E\rho$ component is expected, and this will vary only with $\rho$. Now to find this component.

We choose a point $P(0,y,0)$ on the $y$ axis at which to determine the field. This is a perfectly general point in view of the lack of variation of the field with $\phi$ and $z$. Applying (10) to find the incremental fi

[Truncated for analysis]

## Core Ideas

- Rotational invariance removes all $\phi$ dependence.
- Translation invariance along the line removes all $z$ dependence.
- The field may vary with radial distance $\rho$.
- No source element produces a net azimuthal component.
- Axial components cancel in symmetric pairs above and below the observation plane.
- The only surviving component is $E_\rho(\rho)$.

## Source Anchors

- The source is a uniform line charge extending from $-\infty$ to $\infty$ along the $z$ axis.
- The text identifies azimuthal symmetry and axial symmetry separately.
- Pairs of source elements at opposite values of $z'$ cancel their $E_z$ contributions.
- Source figure S1.P48.F1, Figure 2.6, shows $d\mathbf{E}=dE_\rho\mathbf{a}_\rho+dE_z\mathbf{a}_z$ from $dQ=\rho_Ldz'$.
- The general observation point may be chosen in the $xy$ plane because the field is independent of $\phi$ and $z$.

## Related Pages

- [[derivation-and-distance-scaling-of-the-infinite-line-field|Derivation and Distance Scaling of the Infinite-Line Field]]
- [[off-axis-infinite-line-charge|Off-Axis Infinite Line Charge]]
- [[field-of-an-infinite-uniform-sheet|Field of an Infinite Uniform Sheet]]

## Concept Dependencies

- enables: [[derivation-and-distance-scaling-of-the-infinite-line-field|Derivation and Distance Scaling of the Infinite-Line Field]]
