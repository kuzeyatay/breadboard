---
title: "Boundary Conditions Require a Reflected Wave"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "boundary-conditions-require-a-reflected-wave"
locations: ["Page 423, boundary-condition argument and Equations (5) through (8)"]
related: ["incident-reflected-and-transmitted-plane-waves", "reflection-and-transmission-coefficients", "total-reflection-from-a-perfect-conductor", "multiple-interface-reflection"]
---

## ConceptNode: Boundary Conditions Require a Reflected Wave

Planning node for [[boundary-conditions-require-a-reflected-wave|1.245 Boundary Conditions Require a Reflected Wave]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 423, boundary-condition argument and Equations (5) through (8)

At an interface without a surface current sheet, the tangential electric and magnetic fields must be continuous. If only incident and transmitted waves are assumed, electric-field continuity at $z=0$ requires equal electric amplitudes on the two sides. Magnetic-field continuity simultaneously requires those amplitudes divided by their respective intrinsic impedances to be equal. Both conditions can hold with only these two waves only in the special matched case $\eta_1=\eta_2$. For a general impedance mismatch, the model is incomplete. A reflected wave in region 1 supplies the additional electric and magnetic amplitudes needed to satisfy both boundary conditions. At the interface, the resulting equations are $$E_{x10}^{+}+E_{x10}^{-}=E_{x20}^{+}$$ and $$\frac{E_{x10}^{+}}{\eta_1}-\frac{E_{x10}^{-}}{\eta_1}=\frac{E_{x20}^{+}}{\eta_2}.$$ The minus sign in the reflected magnetic contribution follows from its reversed propagation direction.

### Key planning details

- Tangential $\mathbf{E}$ is continuous at the interface.
- Tangential $\mathbf{H}$ is continuous when no surface current sheet is present.
- Incident and transmitted waves alone satisfy both conditions only when $\eta_1=\eta_2$.
- An impedance mismatch requires a reflected wave.
- Electric amplitudes add at the boundary.
- The reflected magnetic amplitude enters the magnetic boundary equation with a minus sign.
- The two boundary equations determine the reflected and transmitted amplitudes.

### Source coverage

- Page 423 shows that an incident-plus-transmitted assumption would require both $E_{x10}^{+}=E_{x20}^{+}$ and $E_{x10}^{+}/\eta_1=E_{x20}^{+}/\eta_2$.
- The text concludes that these imply the special condition $\eta_1=\eta_2$.
- Equation (7) is $E_{x10}^{+}+E_{x10}^{-}=E_{x20}^{+}$.
- Equation (8) is $E_{x10}^{+}/\eta_1-E_{x10}^{-}/\eta_1=E_{x20}^{+}/\eta_2$.
- Figure 12.1 includes the reflected wave required in region 1.
