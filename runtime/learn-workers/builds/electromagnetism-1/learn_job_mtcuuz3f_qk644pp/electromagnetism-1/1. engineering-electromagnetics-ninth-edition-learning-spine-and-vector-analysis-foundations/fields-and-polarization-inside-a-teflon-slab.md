---
title: "1.71 Fields and Polarization Inside a Teflon Slab"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 150", "Page 151", "Example 5.5", "Figure 5.12"]
related: ["refraction-of-fields-at-a-dielectric-boundary", "normal-and-tangential-field-decomposition", "dielectric-polarization-and-effective-permittivity-tasks"]
---

# 1.71 Fields and Polarization Inside a Teflon Slab

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 150, Page 151, Example 5.5, Figure 5.12

Example 5.5 applies dielectric boundary conditions to a Teflon slab occupying $0\leq x\leq a$, with free space on both sides and a uniform external field $\mathbf E_{\text{out}}=E_0\mathbf a_x$. Because the field is normal to the slab interfaces and no free surface charge is specified, the normal component of $\mathbf D$ is continuous. Therefore, $\mathbf D_{\text{in}}=\mathbf D_{\text{out}}=\epsilon_0E_0\mathbf a_x$. Inside Teflon, whose relative permittivity is $\epsilon_r=2.1$, the electric field is reduced by the factor $1/\epsilon_r$, giving $\mathbf E_{\text{in}}=0.476E_0\mathbf a_x$. Polarization accounts for the difference between total flux density and the vacuum contribution $\epsilon_0\mathbf E$. Using $\mathbf D=\epsilon_0\mathbf E+\mathbf P$ gives $\mathbf P_{\text{in}}=0.524\epsilon_0E_0\mathbf a_x$. The example illustrates a general solution order: infer the known field quantities in one region, apply the relevant component boundary condition, use the constitutive relation in the second material, and then calculate polarization. Figure 5.12 depicts this external-to-internal field workflow.

## Page-Grounded Details

#### Page 150

or
$$
\epsilon_{2}D_{1}sin\theta_{1}=\epsilon_{1}D_{2}sin\theta_{2}\qquad(40)
$$
and the division of this equation by (39) gives
$$
\frac{\tan\theta_{1}}{\tan\theta_{2}}=\frac{\epsilon_{1}}{\epsilon_{2}}\qquad(41)
$$
In Figure 5.11 we have assumed that $\epsilon_{1} >\epsilon_{2}$, and therefore $\theta_{1} >\theta_{2}$.

The direction of E on each side of the boundary is identical with the direction of D, because $\mathbf{D}=\epsilon\mathbf{E}$.

The magnitude of D in region 2 may be found from Eq. (39) and (40),
$$
D_{2}=D_{1}\sqrt{\cos^{2}\theta_{1}+\left(\frac{\epsilon_{2}}{\epsilon_{1}}\right)^{2}\sin^{2}\theta_{1}}\qquad(42)
$$
and the magnitude of $\mathbf{E}_{2}$ is
$$
E_{2}=E_{1}\sqrt{\sin^{2}\theta_{1}+\left(\frac{\epsilon_{1}}{\epsilon_{2}}\right)^{2}\cos^{2}\theta_{1}}\qquad(43)
$$
An inspection of these equations shows that D is larger in the region of larger permittivity (unless $\theta_{1}=\theta_{2}=0^{\circ}$ where the magnitude is unchanged) and that E is larger in the region of smaller permittivity (unless $\theta_{1}=\theta_{2}=90^{\circ}$, where its magnitude is unchanged).

#### Example 5.5

Complete Example 5.4 by finding the fields within

[Truncated for analysis]

#### Page 151

Figure 5.12 A knowledge of the electric field external to the dielectric enables us to find the remaining external fields first and then to use the continuity of normal $\mathbf{D}$ to begin finding the internal fields.

D5.9. Let Region 1 ($z<0$) be composed of a uniform dielectric material for which $\epsilon_{r}=3.2$, while Region 2 ($z>0$) is characterized by $\epsilon_{r}=2$. Let $\mathbf{D}_{1}=-30\mathbf{a}_{x}+50\mathbf{a}_{y}+70\mathbf{a}_{z}$ nC/m^2 and find: (a) $D_{N1}$; (b) $\mathbf{D}_{t1}$; (c) $D_{t1}$; (d) $D_{1}$; (e) $\theta_{1}$; (f) $\mathbf{P}_{1}$.

Ans. (a) 70 nC/m^2; (b) $-30\mathbf{a}_{x}+50\mathbf{a}_{y}$ nC/m^2; (c) 58.3 nC/m^2; (d) 91.1 nC/m^2; (e) 39.8 deg; (f) $-20.6\mathbf{a}_{x}+34.4\mathbf{a}_{y}+48.1\mathbf{a}_{z}$ nC/m^2

D5.10. Continue Problem D5.9 by finding: (a) $\mathbf{D}_{N2}$; (b) $\mathbf{D}_{t2}$; (c) $\mathbf{D}_{2}$; (d) $\mathbf{P}_{2}$; (e) $\theta_{2}$.

Ans. (a) $70\mathbf{a}_{z}$ nC/m^2; (b) $-18.75\mathbf{a}_{x}+31.25\mathbf{a}_{y}$ nC/m^2; (c) $-18.75\mathbf{a}_{x}+31.25\mathbf{a}_{y}+70\mathbf{a}_{z}$ nC/m^2; (d) $-9.38\mathbf{a}_{x}+15.63\mathbf{a}_{y}+35\mathbf{a}_{z}$ nC/m^2; (e

[Truncated for analysis]

## Core Ideas

- The Teflon slab occupies $0\leq x\leq a$ and has $\epsilon_r=2.1$.
- The applied field is normal to the slab: $\mathbf E_{\text{out}}=E_0\mathbf a_x$.
- Normal $\mathbf D$ continuity gives $\mathbf D_{\text{in}}=\epsilon_0E_0\mathbf a_x$.
- The internal electric field is reduced to $0.476E_0\mathbf a_x$.
- The internal polarization is $0.524\epsilon_0E_0\mathbf a_x$.
- Boundary conditions connect partial field information on both sides of an interface.

## Source Anchors

- Outside the slab, $\mathbf D_{\text{out}}=\epsilon_0E_0\mathbf a_x$ and $\mathbf P_{\text{out}}=0$.
- $\mathbf E_{\text{in}}=\mathbf D_{\text{in}}/(\epsilon_r\epsilon_0)=0.476E_0\mathbf a_x$.
-
$$
\mathbf P_{\text{in}}=\mathbf D_{\text{in}}-\epsilon_0\mathbf E_{\text{in}}=0.524\epsilon_0E_0\mathbf a_x
$$
- All three internal fields are specified for $0\leq x\leq a$.
- Figure 5.12 explains that known external $\mathbf E$ determines the other external fields before normal $\mathbf D$ continuity is used.
- Visual opportunity S1.P151.F1: recreate Figure 5.12 as a slab diagram showing $\mathbf E$, $\mathbf D$, and $\mathbf P$ inside and outside.

## Related Pages

- [[refraction-of-fields-at-a-dielectric-boundary|Refraction of Fields at a Dielectric Boundary]]
- [[normal-and-tangential-field-decomposition|Normal and Tangential Field Decomposition]]
- [[dielectric-polarization-and-effective-permittivity-tasks|Dielectric Polarization and Effective Permittivity Tasks]]

## Concept Dependencies

- applies-to: [[refraction-of-fields-at-a-dielectric-boundary|Refraction of Fields at a Dielectric Boundary]]
- depends-on: [[normal-and-tangential-field-decomposition|Normal and Tangential Field Decomposition]]
