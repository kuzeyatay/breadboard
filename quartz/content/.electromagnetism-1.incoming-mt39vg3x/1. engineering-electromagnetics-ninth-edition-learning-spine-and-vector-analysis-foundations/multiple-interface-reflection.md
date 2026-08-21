---
title: "1.251 Multiple-Interface Reflection"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 432, Section 12.3 and Section 12.3.1 introduction"]
related: ["incident-reflected-and-transmitted-plane-waves", "reflection-and-transmission-coefficients", "boundary-conditions-require-a-reflected-wave", "power-reflectivity-and-conservation"]
---

# 1.251 Multiple-Interface Reflection

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 432, Section 12.3 and Section 12.3.1 introduction

A finite material layer introduces two interfaces rather than the single boundary between semi-infinite media. The source defines three regions with intrinsic impedances $\eta_1$, $\eta_2$, and $\eta_3$. Region 2 has thickness $l$, its second interface is placed at $z=0$, and its first interface is at $z=-l$. When a forward-traveling wave reaches the first interface, part reflects into region 1 and part enters region 2. At the second interface, part transmits into region 3 while the remainder reflects back through region 2. That returning wave is again partially reflected and transmitted at the first interface, producing an ongoing sequence of internal bounces. Tracking every individual reflection is appropriate during the transient establishment of the fields but becomes cumbersome. If the incident wave is maintained indefinitely, the system reaches a steady state in which the many contributions combine into overall reflected, internal, and transmitted fields. Flat glass and dielectric reflection-reducing coatings are identified as practical examples.

## Page-Grounded Details

#### Page 432

Solution. The 1.5 m spacing between maxima is $\lambda/2$, which implies that a wavelength is 3.0 m, or $f=100$ MHz. The first maximum at 0.75 m is thus at a distance of $\lambda/4$ from the interface, which means that a field minimum occurs at the boundary. Thus $\Gamma$ will be real and negative. We use (27) to write
$$
|\Gamma| = \frac{s - 1}{s + 1} = \frac{5 - 1}{5 + 1} = \frac{2}{3}
$$
So
$$
\Gamma = -\frac{2}{3} = \frac{\eta_u - \eta_0}{\eta_u + \eta_0}
$$
which we solve for $\eta_u$ to obtain
$$
\eta_u = \frac{1}{5} \eta_0 = \frac{377}{5} = 75.4 \, \Omega
$$
### 12.3 WAVE REFLECTION FROM MULTIPLE INTERFACES

So far we have treated the reflection of waves at the single boundary that occurs between semi-infinite media. In this section, we consider wave reflection from materials that are finite in extent, such that we must consider the effect of the front and back surfaces. Such a two-interface problem would occur, for example, for light incident on a flat piece of glass. Additional interfaces are present if the glass is coated with one or more layers of dielectric material for the purpose (as we will see) of reducing reflections. Such problems in which more tha

[Truncated for analysis]

## Core Ideas

- A finite slab requires both its front and back interfaces to be included.
- The three regions have impedances $\eta_1$, $\eta_2$, and $\eta_3$.
- Region 2 has thickness $l$ between $z=-l$ and $z=0$.
- Each encounter with an interface produces partial reflection and transmission.
- Reflected waves can bounce repeatedly inside the middle layer.
- Individual bounce tracking is complicated during the transient process.
- A continuously applied incident wave eventually establishes a steady-state superposition.
- Glass plates and dielectric coatings are practical multiple-interface systems.

## Source Anchors

- Section 12.3 contrasts finite materials with the earlier single boundary between semi-infinite media.
- The text cites light incident on a flat piece of glass as a two-interface example.
- It cites one or more dielectric coating layers as additional interfaces used to reduce reflection.
- Section 12.3.1 places the second interface at $z=0$ and the first at $z=-l$.
- The source describes repeated partial reflection and transmission within region 2.
- The text distinguishes the transient sequence of bounces from the eventual steady-state situation.

## Related Pages

- [[incident-reflected-and-transmitted-plane-waves|Incident, Reflected, and Transmitted Plane Waves]]
- [[reflection-and-transmission-coefficients|Reflection and Transmission Coefficients]]
- [[boundary-conditions-require-a-reflected-wave|Boundary Conditions Require a Reflected Wave]]
- [[power-reflectivity-and-conservation|Power Reflectivity and Conservation]]

