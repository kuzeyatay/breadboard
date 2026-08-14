---
title: "1.79 Parallel-Plate Capacitance"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 159", "Page 160", "Section 6.2: Parallel-Plate Capacitor", "Example 6.1", "Figure 6.2"]
related: ["capacitance-as-a-charge-to-potential-ratio", "electric-energy-stored-in-a-capacitor", "series-and-parallel-multiple-dielectric-capacitors"]
---

# 1.79 Parallel-Plate Capacitance

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 159, Page 160, Section 6.2: Parallel-Plate Capacitor, Example 6.1, Figure 6.2

For parallel conducting plates separated by distance $d$ in a homogeneous dielectric of permittivity $\epsilon$, equal and opposite surface charge densities produce an approximately uniform field away from the edges. The conductor boundary condition gives $\mathbf D=\rho_S\mathbf a_z$, and the constitutive relation gives $\mathbf E=(\rho_S/\epsilon)\mathbf a_z$. Integrating the electric field between the plates yields $V_0=\rho_Sd/\epsilon$. For finite plates of area $S$ whose lateral dimensions greatly exceed $d$, edge effects occupy only a small part of the field region. With $Q=\rho_SS$, substitution into $C=Q/V_0$ gives
$$
C=\frac{\epsilon S}{d}
$$
 The formula shows that capacitance increases with plate area and dielectric permittivity and decreases with plate separation. Example 6.1 applies the formula to mica with $\epsilon_r=6$, area $10$ in.$^2$, and spacing $0.01$ in., obtaining $1.349$ nF after unit conversion. Practical capacitors increase effective area by stacking or rolling conductors separated by thin dielectric layers.

## Page-Grounded Details

#### Page 159

#### 6.2 PARALLEL-PLATE CAPACITOR

We can apply the definition of capacitance to a simple two-conductor system in which the conductors are identical, infinite parallel planes with separation $d$ (Figure 6.2). Choosing the lower conducting plane at $z=0$ and the upper one at $z=d$, a uniform sheet of surface charge $\pm\rho_{S}$ on each conductor leads to the uniform field [Section 2.5, Eq. (18)]
$$
\mathbf{E}=\frac{\rho_{S}}{\epsilon}\mathbf{a}_{z}
$$
where the permittivity of the homogeneous dielectric is $\epsilon$, and
$$
\mathbf{D}=\rho_{S}\mathbf{a}_{z}
$$
Note that this result could be obtained by applying the boundary condition at a conducting surface (Eq. (18), Chapter 5) at either one of the plate surfaces. Referring to the surfaces and their unit normal vectors in Fig. 6.2, where $\mathbf{n}_{\ell}=\mathbf{a}_{z}$ and $\mathbf{n}_{u}=-\mathbf{a}_{z}$, we find on the lower plane:
$$
\mathbf{D}\cdot\mathbf{n}_{\ell}|_{z=0}=\mathbf{D}\cdot\mathbf{a}_{z}=\rho_{s}\Rightarrow\mathbf{D}=\rho_{s}\mathbf{a}_{z}
$$
On the upper plane, we get the same result
$$
\mathbf{D}\cdot\mathbf{n}_{u}|_{z=d}=\mathbf{D}\cdot(-\mathbf{a}_{z})=-\rho_{s}\Rightarrow\mathbf{D}=\

[Truncated for analysis]

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
 C=\frac{6\times 8.854\times 10^{-12}\times 6.45\times 10^{-3}}{2.54\times 10^{-4}}=1.349\text{nF} $$
A large plate area is obtained in capacitors of small physical dimensions by stacking smaller plates in 50- or 100-decker sandwiches, or by

[Truncated for analysis]

## Core Ideas

- The ideal parallel-plate field is uniform and normal to both plates.
- $\mathbf D=\rho_S\mathbf a_z$ follows from the conductor boundary condition.
- $V_0=\rho_Sd/\epsilon$ follows from integrating the field.
- The finite-plate approximation is valid when lateral dimensions greatly exceed $d$.
- The capacitance is $C=\epsilon S/d$.
- Stacked and rolled constructions increase effective plate area.

## Source Anchors

- Figure 6.2 shows plates at $z=0$ and $z=d$ with opposite surface charge densities.
- The source derives $\mathbf E=(\rho_S/\epsilon)\mathbf a_z$ and $\mathbf D=\rho_S\mathbf a_z$.
- Equation (3) gives $Q=\rho_SS$ and $V_0=(\rho_S/\epsilon)d$.
- Example 6.1 converts $10$ in.$^2$ to $6.45\times10^{-3}$ m$^2$ and $0.01$ in. to $2.54\times10^{-4}$ m.
- Example 6.1 obtains $C=1.349$ nF.
- Visual opportunity S1.P159.F1: recreate Figure 6.2 with normals, surface charges, field direction, and adjustable $S$, $d$, and $\epsilon$.

## Related Pages

- [[capacitance-as-a-charge-to-potential-ratio|Capacitance as a Charge-to-Potential Ratio]]
- [[electric-energy-stored-in-a-capacitor|Electric Energy Stored in a Capacitor]]
- [[series-and-parallel-multiple-dielectric-capacitors|Series and Parallel Multiple-Dielectric Capacitors]]

## Concept Dependencies

- derives-from: [[capacitance-as-a-charge-to-potential-ratio|Capacitance as a Charge-to-Potential Ratio]]
