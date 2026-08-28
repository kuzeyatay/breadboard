---
title: "1.245 Boundary Conditions Require a Reflected Wave"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 423, boundary-condition argument and Equations (5) through (8)"]
related: ["incident-reflected-and-transmitted-plane-waves", "reflection-and-transmission-coefficients", "total-reflection-from-a-perfect-conductor", "multiple-interface-reflection"]
---

# 1.245 Boundary Conditions Require a Reflected Wave

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 423, boundary-condition argument and Equations (5) through (8)

At an interface without a surface current sheet, the tangential electric and magnetic fields must be continuous. If only incident and transmitted waves are assumed, electric-field continuity at $z=0$ requires equal electric amplitudes on the two sides. Magnetic-field continuity simultaneously requires those amplitudes divided by their respective intrinsic impedances to be equal. Both conditions can hold with only these two waves only in the special matched case $\eta_1=\eta_2$. For a general impedance mismatch, the model is incomplete. A reflected wave in region 1 supplies the additional electric and magnetic amplitudes needed to satisfy both boundary conditions. At the interface, the resulting equations are
$$
E_{x10}^{+}+E_{x10}^{-}=E_{x20}^{+}
$$
 and
$$
\frac{E_{x10}^{+}}{\eta_1}-\frac{E_{x10}^{-}}{\eta_1}=\frac{E_{x20}^{+}}{\eta_2}
$$
 The minus sign in the reflected magnetic contribution follows from its reversed propagation direction.

## Page-Grounded Details

#### Page 423

This wave, which moves away from the boundary surface into region 2, is called the transmitted wave. Note the use of the different propagation constant $k_{2}$ and intrinsic impedance $\eta_{2}$.

The boundary conditions at $z=0$ must be satisfied with these assumed fields. With E polarized along x, the field is tangent to the interface, and therefore the E fields in regions 1 and 2 must be equal at $z=0$. Setting $z=0$ in (1) and (3) would require that $E_{x10}^{+}=E_{x20}^{+}$. H, being y-directed, is also a tangential field, and must be continuous across the boundary (no current sheets are present in real media). When we let $z=0$ in (2) and (4), we find that we must have $E_{x10}^{+}/\eta_{1}=E_{x20}^{+}/\eta_{2}$. Since $E_{x10}^{+}=E_{x20}^{+}$, then $\eta_{1}=\eta_{2}$. But this is a very special condition that does not fit the facts in general, and we are therefore unable to satisfy the boundary conditions with only an incident and a transmitted wave. We require a wave traveling away from the boundary in region 1, as shown in Figure 12.1; this is the reflected wave,
$$
E_{xs1}^{-}(z)=E_{x10}^{-}e^{jk_{1}z}\quad{(5)}
$$
$$ H_{xs1}^{-}(z)=-\frac{E_{x10}^

[Truncated for analysis]

## Core Ideas

- Tangential $\mathbf{E}$ is continuous at the interface.
- Tangential $\mathbf{H}$ is continuous when no surface current sheet is present.
- Incident and transmitted waves alone satisfy both conditions only when $\eta_1=\eta_2$.
- An impedance mismatch requires a reflected wave.
- Electric amplitudes add at the boundary.
- The reflected magnetic amplitude enters the magnetic boundary equation with a minus sign.
- The two boundary equations determine the reflected and transmitted amplitudes.

## Source Anchors

- Page 423 shows that an incident-plus-transmitted assumption would require both $E_{x10}^{+}=E_{x20}^{+}$ and $E_{x10}^{+}/\eta_1=E_{x20}^{+}/\eta_2$.
- The text concludes that these imply the special condition $\eta_1=\eta_2$.
- Equation (7) is $E_{x10}^{+}+E_{x10}^{-}=E_{x20}^{+}$.
- Equation (8) is $E_{x10}^{+}/\eta_1-E_{x10}^{-}/\eta_1=E_{x20}^{+}/\eta_2$.
- Figure 12.1 includes the reflected wave required in region 1.

## Related Pages

- [[incident-reflected-and-transmitted-plane-waves|Incident, Reflected, and Transmitted Plane Waves]]
- [[reflection-and-transmission-coefficients|Reflection and Transmission Coefficients]]
- [[total-reflection-from-a-perfect-conductor|Total Reflection from a Perfect Conductor]]
- [[multiple-interface-reflection|Multiple-Interface Reflection]]

## Concept Dependencies

- derives: [[reflection-and-transmission-coefficients|Reflection and Transmission Coefficients]]
- applies-to: [[multiple-interface-reflection|Multiple-Interface Reflection]]
