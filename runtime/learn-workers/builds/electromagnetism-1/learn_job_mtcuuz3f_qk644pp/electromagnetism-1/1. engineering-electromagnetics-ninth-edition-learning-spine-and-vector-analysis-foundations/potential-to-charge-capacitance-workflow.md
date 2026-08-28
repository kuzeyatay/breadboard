---
title: "1.93 Potential-to-Charge Capacitance Workflow"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 177", "Page 178"]
related: ["direct-integration-of-one-dimensional-laplace-problems", "cylindrical-one-dimensional-potential-solutions", "spherical-one-dimensional-potential-solutions", "capacitance-estimation-from-a-flux-plot"]
---

# 1.93 Potential-to-Charge Capacitance Workflow

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 177, Page 178

Once a potential function has been found from Laplace's equation, capacitance is obtained by systematically reconstructing the field and conductor charge. First calculate $\mathbf{E}=-\nabla V$. Next use $\mathbf{D}=\epsilon\mathbf{E}$. Evaluate the normal component of $\mathbf{D}$ at a conductor surface, identify $\rho_S=D_N$, and integrate the surface charge density to obtain $Q$. Finally use $C=|Q|/V_0$. For the parallel-plate solution $V=V_0x/d$, the source obtains
$$
\mathbf{E}=-\frac{V_0}{d}\mathbf{a}_x
$$
$$
\mathbf{D}=-\epsilon\frac{V_0}{d}\mathbf{a}_x
$$
 and, on the plate at $x=0$ with outward normal $\mathbf{a}_x$,
$$
\rho_S=-\epsilon\frac{V_0}{d}
$$
 Integrating over plate area $S$ gives $Q=-\epsilon V_0S/d$, so the capacitance magnitude is
$$
C=\frac{\epsilon S}{d}
$$
 This workflow is reused for cylindrical and spherical capacitor geometries.

## Page-Grounded Details

#### Page 177

and the partial derivative may be replaced by an ordinary derivative, since V is not a function of y or z,
$$
\frac{d^{2}V}{dx^{2}}=0
$$
We integrate twice, obtaining
$$
\frac{dV}{dx}=A
$$
and
$$
V=Ax+B\quad{(31)}
$$
where A and B are constants of integration. Equation (31) contains two such constants, as we would expect for a second-order differential equation. These constants can be determined only from the boundary conditions.

Since the field varies only with x and is not a function of y and z, then V is a constant if x is a constant or, in other words, the equipotential surfaces are parallel planes normal to the x axis. The field is thus that of a parallel-plate capacitor, and as soon as we specify the potential on any two planes, we may evaluate our constants of integration.

#### Example 6.2

Start with the potential function, Eq. (31), and find the capacitance of a parallel-plate capacitor of plate area S, plate separation d, and potential difference $V_{0}$ between plates.

Solution. Take V= 0 at x= 0 and $V=V_{0}$ at x=d. Then from Eq. (31),
$$
A=\frac{V_{0}}{d}\quad B=0
$$
and
$$
V=\frac{V_{0}x}{d}\quad{(32)}
$$
We still need the total charge on either plat

[Truncated for analysis]

#### Page 178

Here we have
$$
V=V_{0}\frac{x}{d}
$$
$$
E=-\frac{V_{0}}{d}a_{x}
$$
$$
D=-\epsilon\frac{V_{0}}{d}a_{x}
$$
$$
D_{S}=\left.D\right|_{x=0}=-\epsilon\frac{V_{0}}{d}a_{x}
$$
$$
a_{N}=a_{x}
$$
$$
D_{N}=-\epsilon\frac{V_{0}}{d}=\rho_{S}
$$
$$
Q=\int_{S}\frac{-\epsilon\,V_{0}}{d}dS=-\epsilon\frac{V_{0}S}{d}
$$
and the capacitance is
$$
C=\frac{|Q|}{V_{0}}=\frac{\epsilon S}{d}
$$
(33)

We will use this procedure several times in the examples to follow.

#### Example 6.3

Because no new problems are solved by choosing fields which vary only with y or with z in rectangular coordinates, we pass on to cylindrical coordinates for our next example. Variations with respect to z are again nothing new, and we next assume variation with respect to $\rho$ only. Laplace's equation becomes
$$
\frac{1}{\rho}\frac{\partial}{\partial\rho}\left(\rho\frac{\partial V}{\partial\rho}\right)=0
$$
Noting the $\rho$ in the denominator, we exclude $\rho=0$ from our solution and then multiply by $\rho$ and integrate,
$$
\rho\frac{dV}{d\rho}=A
$$
where a total derivative replaces the partial derivative because V varies only with $\rho$. Next, rearrange, and integrate again,
$$
V=A\ln\rho+B
$$
[Truncated for analysis]

## Core Ideas

- Compute $\mathbf{E}$ from the negative gradient of $V$.
- Compute $\mathbf{D}$ using the material permittivity.
- Evaluate the normal flux density at the conductor.
- Use $\rho_S=D_N$ at the conductor surface.
- Integrate $\rho_S$ over the conductor to find total charge.
- Use the magnitude of charge in $C=|Q|/V_0$.
- For parallel plates, $C=\epsilon S/d$.

## Source Anchors

- Example 6.2 lists the five-step potential-to-charge procedure.
- At $x=0$, $\mathbf{D}_S=-\epsilon V_0\mathbf{a}_x/d$.
- The source identifies $D_N=\rho_S$.
- The surface integral gives $Q=-\epsilon V_0S/d$.
- Equation (33) gives $C=\epsilon S/d$.
- The text states that the procedure will be reused in later examples.

## Related Pages

- [[direct-integration-of-one-dimensional-laplace-problems|Direct Integration of One-Dimensional Laplace Problems]]
- [[cylindrical-one-dimensional-potential-solutions|Cylindrical One-Dimensional Potential Solutions]]
- [[spherical-one-dimensional-potential-solutions|Spherical One-Dimensional Potential Solutions]]
- [[capacitance-estimation-from-a-flux-plot|Capacitance Estimation from a Flux Plot]]

## Concept Dependencies

- depends-on: [[direct-integration-of-one-dimensional-laplace-problems|Direct Integration of One-Dimensional Laplace Problems]]
