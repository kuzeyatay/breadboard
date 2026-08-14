---
title: "1.252 Finite Dielectric Slab as a Two-Interface System"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 433", "Page 434", "Section 12.3.2: Wave Impedance"]
related: ["input-impedance-net-slab-reflection", "half-wave-matching", "quarter-wave-matching-antireflection-coatings", "recursive-impedance-transformation-multilayers"]
---

# 1.252 Finite Dielectric Slab as a Two-Interface System

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 433, Page 434, Section 12.3.2: Wave Impedance

A finite dielectric slab creates a two-interface reflection problem because waves reflect repeatedly between its front and back surfaces. In steady state, the many individual reflections combine into five net waves: an incident wave and a net reflected wave in region 1, forward and backward waves in region 2, and a net transmitted wave in region 3. Each net wave has a definite complex amplitude and phase obtained by superposing all co-propagating contributions. For a lossless slab of thickness $l$, the region-2 fields are written as counterpropagating phasors. The backward electric-field amplitude is tied to the forward amplitude by the second-interface coefficient $\Gamma_{23}=(\eta_3-\eta_2)/(\eta_3+\eta_2)$. Because the magnetic field reverses its electric-to-magnetic sign relationship for backward propagation, the total field ratio varies with position. This position-dependent ratio is the wave impedance $\eta_w(z)=E_{xs2}/H_{ys2}$. Evaluating it at the slab's front surface gives an input impedance that summarizes the slab and region 3 as seen from region 1. The original multiple-reflection problem can then be treated as a single impedance discontinuity.

## Page-Grounded Details

#### Page 433

Figure 12.4 Basic two-interface problem, in which the impedances of regions 2 and 3, along with the finite thickness of region 2, are accounted for in the input impedance at the front surface, $\eta_{in}$.

from the two-interface configuration and back-propagates in region 1 with a definite amplitude and phase; (2) an overall fraction of the incident wave is transmitted through the two interfaces and forward-propagates in the third region; (3) a net backward wave exists in region 2, consisting of all reflected waves from the second interface; and (4) a net forward wave exists in region 2, which is the superposition of the transmitted wave through the first interface and all waves in region 2 that have reflected from the first interface and are now forward-propagating. The effect of combining many co-propagating waves in this way is to establish a single wave which has a definite amplitude and phase, determined through the sums of the amplitudes and phases of all the component waves. In steady state, we thus have a total of five waves to consider. These are the incident and net reflected waves in region 1, the net transmitted wave in region 3, and the two counterpropagating waves

[Truncated for analysis]

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

## Core Ideas

- The steady-state system contains five net waves across the three regions.
- The region-2 electric field is $E_{xs2}=E_{x20}^{+}e^{-j\beta_2 z}+E_{x20}^{-}e^{j\beta_2 z}$.
- For a lossless dielectric, $\beta_2=\omega\sqrt{\epsilon_{r2}}/c$.
- The back-interface coefficient is $\Gamma_{23}=(\eta_3-\eta_2)/(\eta_3+\eta_2)$.
- The amplitudes satisfy $E_{x20}^{-}=\Gamma_{23}E_{x20}^{+}$.
- Backward propagation introduces $H_{y20}^{-}=-E_{x20}^{-}/\eta_2$.
- The wave impedance is a position-dependent ratio of total electric and magnetic fields.

## Source Anchors

- Figure S1.P433.F1, corresponding to Figure 12.4, depicts the basic two-interface system and the input impedance $\eta_{\mathrm{in}}$ at the front surface.
- Page 433 identifies incident and reflected waves in region 1, counterpropagating waves in region 2, and a transmitted wave in region 3.
- Equation (28a) gives $E_{xs2}=E_{x20}^{+}e^{-j\beta_2z}+E_{x20}^{-}e^{j\beta_2z}$.
- Equation (28b) gives $H_{ys2}=H_{y20}^{+}e^{-j\beta_2z}+H_{y20}^{-}e^{j\beta_2z}$.
- Equations (30), (31a), and (31b) relate the forward and backward field amplitudes through $\Gamma_{23}$ and $\eta_2$.
- Equation (32) gives
$$
\eta_w(z)=\eta_2\frac{\eta_3\cos(\beta_2z)-j\eta_2\sin(\beta_2z)}{\eta_2\cos(\beta_2z)-j\eta_3\sin(\beta_2z)}.$$
## Related Pages

- [[input-impedance-net-slab-reflection|Input Impedance and Net Slab Reflection]]
- [[half-wave-matching|Half-Wave Matching]]
- [[quarter-wave-matching-antireflection-coatings|Quarter-Wave Matching and Antireflection Coatings]]
- [[recursive-impedance-transformation-multilayers|Recursive Impedance Transformation in Multilayers]]

## Concept Dependencies

- depends-on: [[input-impedance-net-slab-reflection|Input Impedance and Net Slab Reflection]]
