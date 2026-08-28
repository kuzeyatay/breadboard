---
title: "1.253 Input Impedance and Net Slab Reflection"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 434", "Page 435", "Section 12.3.2: Wave Impedance"]
related: ["finite-dielectric-slab-two-interface-system", "half-wave-matching", "quarter-wave-matching-antireflection-coatings", "recursive-impedance-transformation-multilayers"]
---

# 1.253 Input Impedance and Net Slab Reflection

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 434, Page 435, Section 12.3.2: Wave Impedance

Tangential electric and magnetic fields must be continuous at the slab's front interface. Applying these conditions at $z=-l$ connects the incident and reflected amplitudes in region 1 to the total fields inside region 2. The wave impedance evaluated at this location is defined as the slab input impedance, $\eta_{\mathrm{in}}=\eta_w(-l)$. Solving the two boundary equations eliminates the unknown internal field and produces a familiar impedance reflection formula, $\Gamma=(\eta_{\mathrm{in}}-\eta_1)/(\eta_{\mathrm{in}}+\eta_1)$. For the finite lossless layer, the input impedance depends on the intrinsic impedances $\eta_2$ and $\eta_3$, the phase constant $\beta_2$, and the thickness $l$. Thus, both material properties and electrical thickness determine the reflected amplitude and phase. The reflected power fraction is $|\Gamma|^2$, while losslessness implies that the transmitted power fraction is $1-|\Gamma|^2$. Although power continually exits region 2 into reflected and transmitted waves, the incident wave replenishes it, so the power stored and flowing within the slab remains steady in the steady-state description.

## Page-Grounded Details

#### Page 434

We thus have
$$
E_{x20}^{-}=\Gamma_{23}E_{x20}^{+}\qquad(30)
$$
We then write the magnetic field amplitudes in terms of electric field amplitudes through
$$
H_{y20}^{+}=\frac{1}{\eta_{2}}E_{x20}^{+}\qquad(31a)
$$
and
$$
H_{y20}^{-}=-\frac{1}{\eta_{2}}E_{x20}^{-}=-\frac{1}{\eta_{2}}\Gamma_{23}E_{x20}^{+}\qquad(31b)
$$
We now define the wave impedance, $\eta_{w}$, as the $z$-dependent ratio of the total electric field to the total magnetic field. In region 2, this becomes, using (28a) and (28b),
$$
\eta_{w}(z)=\frac{E_{xs2}}{H_{ys2}}=\frac{E_{x20}^{+}e^{-j\beta_{2}z}+E_{x20}^{-}e^{j\beta_{2}z}}{H_{y20}^{+}e^{-j\beta_{2}z}+H_{y20}^{-}e^{j\beta_{2}z}}
$$
Then, using (30), (31a), and (31b), we obtain
$$
\eta_{w}(z)=\eta_{2}\left[\frac{e^{-j\beta_{2}z}+\Gamma_{23}e^{j\beta_{2}z}}{e^{-j\beta_{2}z}-\Gamma_{23}e^{j\beta_{2}z}}\right]
$$
Now, using (29) and Euler's identity, we have
$$
\eta_{w}(z)=\eta_{2}\times\frac{(\eta_{3}+\eta_{2})(\cos\beta_{2}z-j\sin\beta_{2}z)+(\eta_{3}-\eta_{2})(\cos\beta_{2}z+j\sin\beta_{2}z)}{(\eta_{3}+\eta_{2})(\cos\beta_{2}z-j\sin\beta_{2}z)-(\eta_{3}-\eta_{2})(\cos\beta_{2}z+j\sin\beta_{2}z)}
$$
This is easily simplified to yield
$$
\eta_{w}(z)

[Truncated for analysis]

#### Page 435

and (34b) together, eliminating $E_{xs2}$, to obtain
$$
 \frac{E_{x10}^{-}}{E_{x10}^{+}}=\Gamma=\frac{\eta_{\rm in}-\eta_{1}}{\eta_{\rm in}+\eta_{1}}\quad{(35)}
$$
To find the input impedance, we evaluate (32) at $z=-l$, resulting in
$$
 \eta_{\rm in}=\eta_{2}\frac{\eta_{3}\cos\beta_{2}l}{\eta_{2}\cos\beta_{2}l+j\eta_{3}\sin\beta_{2}l}\quad{(36)}
$$
Equations (35) and (36) are general results that enable us to calculate the net reflected wave amplitude and phase from two parallel interfaces between lossless media.^1 Note the dependence on the interface spacing, $l$, and on the wavelength as measured in region 2, characterized by $\beta_{2}$. Of immediate importance to us is the fraction of the incident power that reflects from the dual interface and back-propagates in region 1. As we found earlier, this fraction will be $|\Gamma|^{2}$. Also of interest is the transmitted power, which propagates away from the second interface in region 3. It is simply the remaining power fraction, which is $1-|\Gamma|^{2}$. The power in region 2 stays constant in steady state; power leaves that region to form the reflected and transmitted waves, but is immediately replenished by the in

[Truncated for analysis]

## Core Ideas

- Tangential $E$ and $H$ are continuous at the first interface.
- The slab input impedance is $\eta_{\mathrm{in}}=\eta_w(-l)$.
- The net amplitude reflection coefficient is $\Gamma=(\eta_{\mathrm{in}}-\eta_1)/(\eta_{\mathrm{in}}+\eta_1)$.
- The input impedance depends on $\eta_2$, $\eta_3$, $\beta_2$, and $l$.
- The reflected power fraction is $|\Gamma|^2$.
- For lossless media, the transmitted power fraction is $1-|\Gamma|^2$.

## Source Anchors

- Equations (33a) and (33b) impose tangential-field continuity at $z=-l$.
- Equations (34a) and (34b) express the boundary conditions using $E_{x10}^{+}$, $E_{x10}^{-}$, and $\eta_w(-l)$.
- Equation (35) gives
$$
\Gamma=\frac{E_{x10}^{-}}{E_{x10}^{+}}=\frac{\eta_{\mathrm{in}}-\eta_1}{\eta_{\mathrm{in}}+\eta_1}.
$$
- Evaluation of Equation (32) at $z=-l$ gives
$$
\eta_{\mathrm{in}}=\eta_2\frac{\eta_3\cos(\beta_2l)+j\eta_2\sin(\beta_2l)}{\eta_2\cos(\beta_2l)+j\eta_3\sin(\beta_2l)}.$$
- Page 435 states that Equations (35) and (36) determine the net reflected amplitude and phase for two parallel interfaces between lossless media.
- Page 435 identifies $|\Gamma|^2$ and $1-|\Gamma|^2$ as the reflected and transmitted power fractions.

## Related Pages

- [[finite-dielectric-slab-two-interface-system|Finite Dielectric Slab as a Two-Interface System]]
- [[half-wave-matching|Half-Wave Matching]]
- [[quarter-wave-matching-antireflection-coatings|Quarter-Wave Matching and Antireflection Coatings]]
- [[recursive-impedance-transformation-multilayers|Recursive Impedance Transformation in Multilayers]]

## Concept Dependencies

- part-of: [[finite-dielectric-slab-two-interface-system|Finite Dielectric Slab as a Two-Interface System]]
