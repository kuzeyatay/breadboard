---
title: "1.94 Cylindrical One-Dimensional Potential Solutions"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 178", "Page 179", "Page 180", "Page 182"]
related: ["direct-integration-of-one-dimensional-laplace-problems", "potential-to-charge-capacitance-workflow", "spherical-one-dimensional-potential-solutions", "capacitor-geometry-and-dielectric-design-problems"]
---

# 1.94 Cylindrical One-Dimensional Potential Solutions

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 178, Page 179, Page 180, Page 182

Cylindrical coordinates produce two distinct one-dimensional Laplace solutions. For radial variation $V=V(\rho)$, Laplace's equation reduces to
$$
\frac{1}{\rho}\frac{d}{d\rho}\left(\rho\frac{dV}{d\rho}\right)=0
$$
 Excluding $\rho=0$ and integrating twice gives $V=A\ln\rho+B$. For coaxial conductors with $V=V_0$ at $\rho=a$ and $V=0$ at $\rho=b$,
$$
V=V_0\frac{\ln(b/\rho)}{\ln(b/a)}
$$
 The resulting capacitance is
$$
C=\frac{2\pi\epsilon L}{\ln(b/a)}
$$
 For angular variation $V=V(\phi)$, Laplace's equation reduces to $d^2V/d\phi^2=0$. Radial conducting planes at $φ=0$ and $φ=\alpha$ with potentials 0 and $V_0$ produce
$$
V=V_0\frac{\phi}{\alpha}
$$
 and
$$
\mathbf{E}=-\frac{V_0}{\alpha\rho}\mathbf{a}_\phi
$$
 Although the potential depends only on $\phi$, the field magnitude depends on $\rho$ because the cylindrical gradient contains the scale factor $1/\rho$.

## Page-Grounded Details

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

#### Page 179

a potential difference of $V_0$ by letting $V = V_0$ at $\rho = a$, $V = 0$ at $\rho = b$, $b > a$, and obtain
$$
V = V_0 \frac{\ln(b/\rho)}{\ln(b/a)} \quad{(35)}
$$
from which
$$
\begin{align*}
E &= \frac{V_0}{\rho} \frac{1}{\ln(b/a)} a_\rho \\
D_{N(\rho=a)} &= \frac{\epsilon V_0}{a \ln(b/a)} \\
Q &= \frac{\epsilon V_0 2\pi a L}{a \ln(b/a)} \\
C &= \frac{2\pi \epsilon L}{\ln(b/a)} \\
\end{align*} \quad{(36)}
$$
which agrees with our result in Section 6.3 (Eq. (5)).

### EXAMPLE 6.4

Now assume that $V$ is a function only of $\phi$ in cylindrical coordinates. We might look at the physical problem first for a change and see that equipotential surfaces are given by $\phi = \text{constant}$. These are radial planes. Boundary conditions might be $V = 0$ at $\phi = 0$ and $V = V_0$ at $\phi = \alpha$, leading to the physical problem detailed in Figure 6.10.

Figure 6.10      Two infinite radial planes with an interior angle $\alpha$. An infinitesimal insulating gap exists at $\rho = 0$. The potential field may be found by applying Laplace's equation in cylindrical coordinates.

#### Page 180

Laplace's equation is now
$$
\frac{1}{\rho^{2}}\frac{\partial^{2}V}{\partial\phi^{2}}=0
$$
We exclude $\rho=0$ and have
$$
\frac{d^{2}V}{d\phi^{2}}=0
$$
The solution is
$$
V=A\phi+B
$$
The boundary conditions determine A and B, and
$$
V=V_{0}\frac{\phi}{\alpha}\quad{(37)}
$$
Taking the gradient of Eq. (37) produces the electric field intensity,
$$
E=-\frac{V_{0}\mathbf{a}_{\phi}}{\alpha\rho}\quad{(38)}
$$
and it is interesting to note that E is a function of $\rho$ and not of $\phi$. This does not contradict our original assumptions, which were restrictions only on the potential field. Note, however, that the vector field E is in the $\phi$ direction.

A problem involving the capacitance of these two radial planes is included at the end of the chapter.

### EXAMPLE 6.5

We now turn to spherical coordinates, dispose immediately of variations with respect to $\phi$ only as having just been solved, and treat first $V=V(r)$.

The details are left for a problem later, but the final potential field is given by
$$
V=V_{0}\frac{\frac{1}{r}-\frac{1}{b}}{\frac{1}{a}-\frac{1}{b}}\quad{(39)}
$$
where the boundary conditions are evidently V= 0 at r = b and $V=V_{0}$ at

[Truncated for analysis]

#### Page 182

In order to find the capacitance between a conducting cone with its vertex separated from a conducting plane by an infinitesimal insulating gap and its axis normal to the plane, we first find the field strength:
$$
E=-\nabla V=\frac{-1}{r}\frac{\partial V}{\partial\theta}{a}_{\theta}=-\frac{V_{0}}{r\sin\theta\ln\left(\tan\frac{\alpha}{2}\right)}{a}_{\theta}
$$
The surface charge density on the cone is then
$$
\rho_{S}=\frac{-\epsilon\,V_{0}}{r\sin\alpha\ln\left(\tan\frac{\alpha}{2}\right)}
$$
producing a total charge Q,
$$
\begin{align*}Q&=\frac{-\epsilon\,V_{0}}{\sin\alpha\ln\left(\tan\frac{\alpha}{2}\right)}\int_{0}^{\infty}\int_{0}^{2\pi}\frac{r\sin\alpha\,d\phi\,dr}{r}\\ &=\frac{-2\pi\epsilon_{0}\,V_{0}}{\ln\left(\tan\frac{\alpha}{2}\right)}\int_{0}^{\infty}dr\end{align*}
$$
This leads to an infinite value of charge and capacitance, and it becomes necessary to consider a cone of finite size. Our answer will now be only an approximation because the theoretical equipotential surface is $\theta=\alpha$, a conical surface extending from $r=0$ to $r=\infty$, whereas our physical conical surface extends only from $r=0$ to, say, $r=r_{1}$. The approximate capacitance i

[Truncated for analysis]

## Core Ideas

- Radial cylindrical symmetry produces a logarithmic potential.
- The coaxial solution excludes the singular axis $\rho=0$.
- Coaxial equipotential surfaces are cylinders.
- The coaxial capacitance is $2\pi\epsilon L/\ln(b/a)$.
- Angular cylindrical symmetry produces a linear function of $\phi$.
- Constant-$\phi$ equipotential surfaces are radial planes.
- For radial planes, the field is directed along $\mathbf{a}_\phi$ and varies as $1/\rho$.

## Source Anchors

- Equation (34) gives $V=A\ln\rho+B$.
- Equation (35) gives the bounded coaxial potential.
- Equation (36) gives $C=2\pi\epsilon L/\ln(b/a)$.
- S1.P179.F1, Figure 6.10 shows two infinite radial planes separated by angle $\alpha$.
- Equation (37) gives $V=V_0\phi/\alpha$.
- Equation (38) gives $\mathbf{E}=-V_0\mathbf{a}_\phi/(\alpha\rho)$.
- Problem D6.6 asks for field magnitudes in both coaxial-cylinder and radial-plane geometries.

## Related Pages

- [[direct-integration-of-one-dimensional-laplace-problems|Direct Integration of One-Dimensional Laplace Problems]]
- [[potential-to-charge-capacitance-workflow|Potential-to-Charge Capacitance Workflow]]
- [[spherical-one-dimensional-potential-solutions|Spherical One-Dimensional Potential Solutions]]
- [[capacitor-geometry-and-dielectric-design-problems|Capacitor Geometry and Dielectric Design Problems]]

## Concept Dependencies

- example-of: [[direct-integration-of-one-dimensional-laplace-problems|Direct Integration of One-Dimensional Laplace Problems]]
- applies-to: [[potential-to-charge-capacitance-workflow|Potential-to-Charge Capacitance Workflow]]
- contrasts-with: [[spherical-one-dimensional-potential-solutions|Spherical One-Dimensional Potential Solutions]]
