---
title: "1.70 Normal and Tangential Field Decomposition"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 151", "Problems D5.9 and D5.10"]
related: ["refraction-of-fields-at-a-dielectric-boundary", "fields-and-polarization-inside-a-teflon-slab", "dielectric-polarization-and-effective-permittivity-tasks"]
---

# 1.70 Normal and Tangential Field Decomposition

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 151, Problems D5.9 and D5.10

Boundary calculations become systematic when a vector field is decomposed into components normal and tangential to the interface. For the plane $z=0$, the normal direction is $\mathbf a_z$, so the normal component of $\mathbf D_1$ is obtained by projection onto $\mathbf a_z$, while the remaining $x$ and $y$ components form the tangential vector. The angle from the normal follows from the ratio of tangential to normal magnitudes. Across a charge-free dielectric boundary, the normal flux density remains unchanged, but tangential electric field continuity requires the tangential flux density to scale with permittivity. Problems D5.9 and D5.10 provide a complete numerical sequence for this procedure. They begin with $\mathbf D_1$, calculate its normal and tangential parts, magnitude, and angle, then transfer the field into Region 2 and calculate polarization. The polarization in a linear dielectric can be obtained from $\mathbf P=\mathbf D-\epsilon_0\mathbf E$, equivalently $\mathbf P=(1-1/\epsilon_r)\mathbf D$. This pair of exercises is a reusable template for planar-interface problems involving arbitrary vector orientations.

## Page-Grounded Details

#### Page 151

Figure 5.12 A knowledge of the electric field external to the dielectric enables us to find the remaining external fields first and then to use the continuity of normal $\mathbf{D}$ to begin finding the internal fields.

D5.9. Let Region 1 ($z<0$) be composed of a uniform dielectric material for which $\epsilon_{r}=3.2$, while Region 2 ($z>0$) is characterized by $\epsilon_{r}=2$. Let $\mathbf{D}_{1}=-30\mathbf{a}_{x}+50\mathbf{a}_{y}+70\mathbf{a}_{z}$ nC/m^2 and find: (a) $D_{N1}$; (b) $\mathbf{D}_{t1}$; (c) $D_{t1}$; (d) $D_{1}$; (e) $\theta_{1}$; (f) $\mathbf{P}_{1}$.

Ans. (a) 70 nC/m^2; (b) $-30\mathbf{a}_{x}+50\mathbf{a}_{y}$ nC/m^2; (c) 58.3 nC/m^2; (d) 91.1 nC/m^2; (e) 39.8 deg; (f) $-20.6\mathbf{a}_{x}+34.4\mathbf{a}_{y}+48.1\mathbf{a}_{z}$ nC/m^2

D5.10. Continue Problem D5.9 by finding: (a) $\mathbf{D}_{N2}$; (b) $\mathbf{D}_{t2}$; (c) $\mathbf{D}_{2}$; (d) $\mathbf{P}_{2}$; (e) $\theta_{2}$.

Ans. (a) $70\mathbf{a}_{z}$ nC/m^2; (b) $-18.75\mathbf{a}_{x}+31.25\mathbf{a}_{y}$ nC/m^2; (c) $-18.75\mathbf{a}_{x}+31.25\mathbf{a}_{y}+70\mathbf{a}_{z}$ nC/m^2; (d) $-9.38\mathbf{a}_{x}+15.63\mathbf{a}_{y}+35\mathbf{a}_{z}$ nC/m^2; (e

[Truncated for analysis]

## Core Ideas

- For the plane $z=0$, the normal component is the $z$ component.
- The tangential vector contains the $x$ and $y$ components.
- The field angle from the normal satisfies $\tan\theta=D_t/D_N$.
- With no free surface charge, $D_{N1}=D_{N2}$.
- Tangential $\mathbf E$ continuity gives $\mathbf D_{t2}=(\epsilon_2/\epsilon_1)\mathbf D_{t1}$.
- Polarization follows from $\mathbf P=\mathbf D-\epsilon_0\mathbf E$.

## Source Anchors

- D5.9 uses $\epsilon_{r1}=3.2$ and $\mathbf D_1=-30\mathbf a_x+50\mathbf a_y+70\mathbf a_z$ nC/m$^2$.
- D5.9 gives $D_{N1}=70$ nC/m$^2$, $D_{t1}=58.3$ nC/m$^2$, $D_1=91.1$ nC/m$^2$, and $\theta_1=39.8^\circ$.
- D5.10 gives $\mathbf D_{N2}=70\mathbf a_z$ nC/m$^2$.
- D5.10 gives $\mathbf D_{t2}=-18.75\mathbf a_x+31.25\mathbf a_y$ nC/m$^2$.
- D5.10 gives $\theta_2=27.5^\circ$ and $\mathbf P_2=-9.38\mathbf a_x+15.63\mathbf a_y+35\mathbf a_z$ nC/m$^2$.

## Related Pages

- [[refraction-of-fields-at-a-dielectric-boundary|Refraction of Fields at a Dielectric Boundary]]
- [[fields-and-polarization-inside-a-teflon-slab|Fields and Polarization Inside a Teflon Slab]]
- [[dielectric-polarization-and-effective-permittivity-tasks|Dielectric Polarization and Effective Permittivity Tasks]]

