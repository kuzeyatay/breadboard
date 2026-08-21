---
title: "1.145 Displacement Current from Charge Continuity"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 298", "Page 299"]
related: ["capacitor-illustration-of-displacement-current", "maxwell-equations-and-supporting-constitutive-relations", "transition-from-static-fields-to-time-varying-electromagnetics"]
---

# 1.145 Displacement Current from Charge Continuity

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 298, Page 299

Maxwell's modification of Ampère's law is motivated by a consistency problem. The steady-field equation $\nabla\times\mathbf{H}=\mathbf{J}$ implies, after taking divergence, that $\nabla\cdot\mathbf{J}=0$ because the divergence of a curl is identically zero. The continuity equation instead requires
$$
\nabla\cdot\mathbf{J}=-\frac{\partial\rho_v}{\partial t}
$$
 so the unmodified law would permit only time-independent charge density. Maxwell adds a term $\mathbf{G}$ and requires its divergence to equal $\partial\rho_v/\partial t$. Using Gauss's law, $\rho_v=\nabla\cdot\mathbf{D}$, the simplest consistent choice is
$$
\mathbf{G}=\frac{\partial\mathbf{D}}{\partial t}
$$
 The corrected point equation is therefore
$$
\nabla\times\mathbf{H}=\mathbf{J}+\frac{\partial\mathbf{D}}{\partial t}
$$
 The added quantity has units of amperes per square meter and is called displacement current density, $\mathbf{J}_d=\partial\mathbf{D}/\partial t$. It differs physically from conduction current $\mathbf{J}=\sigma\mathbf{E}$ and convection current $\mathbf{J}=\rho_v\mathbf{v}$, but all contribute to the magnetic-field circulation required by the corrected law.

## Page-Grounded Details

#### Page 298

at $t=1\,\mu\mathrm{s}$; (c) find the value of the closed line integral of E around the perimeter of the given surface.

Answer. (a) $-20\,000\,\sin 10^{5}t\cos 10^{-3}y\,\mathbf{a}_{z}\,\mathrm{V/m}$; (b) 0.318 mWb; (c) $-3.19\,\mathrm{V}$

D9.2. With reference to the sliding bar shown in Figure 9.1, let $d=7\,\mathrm{cm}$, $\mathbf{B}=0.3\mathbf{a}_{z}\,\mathrm{T}$, and $\mathbf{v}=0.1\mathbf{a}_{v}e^{20y}\,\mathrm{m/s}$. Let $y=0$ at $t=0$. Find: (a) $v(t=0)$; (b) $y(t=0.1)$; (c) $v(t=0.1)$; (d) $V_{12}$ at $t=0.1$.

Answer. (a) 0.1 m/s; (b) 1.12 cm; (c) 0.125 m/s; (d) $-2.63$ mV

#### 9.2 Displacement Current

Faraday's experimental law has been used to obtain one of Maxwell's equations in differential form,
$$
\nabla\times\mathbf{E}=-\frac{\partial\mathbf{B}}{\partial t}\quad{(15)}
$$
which shows us that a time-changing magnetic field produces an electric field. Remembering the definition of curl, we see that this electric field has the special property of circulation; its line integral about a general closed path is not zero. Now we turn our attention to the time-changing electric field.

#### 9.2.1 Modifying Ampère's Law for Time-Varying Fields

[Truncated for analysis]

#### Page 299

Thus
$$
\nabla\cdot G=\frac{\partial\rho_{v}}{\partial t}
$$
Replacing $\rho_{v}$ with $\nabla\cdot D$,
$$
\nabla\cdot G=\frac{\partial}{\partial t}(\nabla\cdot D)=\nabla\cdot\frac{\partial D}{\partial t}
$$
from which we obtain the simplest solution for G,
$$
G=\frac{\partial D}{\partial t}
$$
Ampère's circuital law in point form therefore becomes
$$
\nabla\times H=J+\frac{\partial D}{\partial t}\quad{(17)}
$$
Equation (17) has not been derived. It is merely a form we have obtained that does not disagree with the continuity equation. It is also consistent with all our other results, and we accept it as we did each experimental law and the equations derived from it. We are building a theory, and we have every right to our equations until they are proved wrong. This has not yet been done.

We now have a second one of Maxwell's equations and shall investigate its significance. The additional term $\partial D/\partial t$ has the dimensions of current density, amperes per square meter. Because it results from a time-varying electric flux density (or displacement density), Maxwell termed it a displacement current density. We sometimes denote it by $J_{d}$:
$$ \nabla\tim

[Truncated for analysis]

## Core Ideas

- The divergence of $\nabla\times\mathbf{H}$ is identically zero.
- Charge continuity requires $\nabla\cdot\mathbf{J}=-\partial\rho_v/\partial t$.
- The steady Ampère law is inadequate when charge density changes with time.
- Gauss's law provides $\rho_v=\nabla\cdot\mathbf{D}$.
- The correction term is $\partial\mathbf{D}/\partial t$.
- Displacement current density is $\mathbf{J}_d=\partial\mathbf{D}/\partial t$.
- The corrected law is $\nabla\times\mathbf{H}=\mathbf{J}+\mathbf{J}_d$.

## Source Anchors

- Equation (16) gives the steady-field form $\nabla\times\mathbf{H}=\mathbf{J}$.
- The source takes divergence and compares the result with $\nabla\cdot\mathbf{J}=-\partial\rho_v/\partial t$.
- The unknown correction $\mathbf{G}$ is constrained by $\nabla\cdot\mathbf{G}=\partial\rho_v/\partial t$.
- Replacing $\rho_v$ by $\nabla\cdot\mathbf{D}$ leads to $\mathbf{G}=\partial\mathbf{D}/\partial t$.
- Equation (17) gives $\nabla\times\mathbf{H}=\mathbf{J}+\partial\mathbf{D}/\partial t$.
- The source identifies conduction current $\mathbf{J}=\sigma\mathbf{E}$ and convection current $\mathbf{J}=\rho_v\mathbf{v}$.

## Related Pages

- [[capacitor-illustration-of-displacement-current|Capacitor Illustration of Displacement Current]]
- [[maxwell-equations-and-supporting-constitutive-relations|Maxwell Equations and Supporting Constitutive Relations]]
- [[transition-from-static-fields-to-time-varying-electromagnetics|Transition from Static Fields to Time-Varying Electromagnetics]]

## Concept Dependencies

- applies-to: [[capacitor-illustration-of-displacement-current|Capacitor Illustration of Displacement Current]]
- part-of: [[maxwell-equations-and-supporting-constitutive-relations|Maxwell Equations and Supporting Constitutive Relations]]
