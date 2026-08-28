---
title: "1.95 Spherical One-Dimensional Potential Solutions"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 180", "Page 181", "Page 182"]
related: ["direct-integration-of-one-dimensional-laplace-problems", "potential-to-charge-capacitance-workflow", "cylindrical-one-dimensional-potential-solutions", "laplace-and-poisson-boundary-value-problem-family"]
---

# 1.95 Spherical One-Dimensional Potential Solutions

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 180, Page 181, Page 182

Spherical coordinates also provide two distinct one-dimensional solutions. For radial dependence $V=V(r)$ between concentric spheres of radii $a$ and $b$, with $V=V_0$ at $r=a$ and $V=0$ at $r=b$, the potential is
$$
V=V_0\frac{1/r-1/b}{1/a-1/b}
$$
 The corresponding capacitance is
$$
C=\frac{4\pi\epsilon}{1/a-1/b}
$$
 For polar-angle dependence $V=V(\theta)$, Laplace's equation reduces to
$$
\frac{1}{r^2\sin\theta}\frac{d}{d\theta}\left(\sin\theta\frac{dV}{d\theta}\right)=0
$$
 Excluding $r=0$ and $\theta=0,\pi$, integration gives
$$
V=A\ln\left(\tan\frac{\theta}{2}\right)+B
$$
 Constant-$\theta$ surfaces are cones. For a cone at $\theta=\alpha$ held at $V_0$ and a plane at $\theta=\pi/2$ held at zero, the potential is the ratio of logarithms shown in Equation (42). The ideal infinite cone yields infinite charge and capacitance, so a finite cone of length $r_1$ is approximated by
$$
C\doteq\frac{2\pi\epsilon r_1}{\ln(\cot(\alpha/2))}
$$
## Page-Grounded Details

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

#### Page 181

In spherical coordinates we now restrict the potential function to $V=V(\theta)$, obtaining
$$
\frac{1}{r^{2}\sin\theta}\frac{d}{d\theta}(\sin\theta\frac{dV}{d\theta})=0
$$
 We exclude $r=0$ and $\theta=0$ or $\pi$ and have
$$
\sin\theta\frac{dV}{d\theta}=A
$$
 The second integral is then
$$
V=\int\frac{A\,d\theta}{\sin\theta}+B
$$
 which is not as obvious as the previous ones. From integral tables (or a good mem-ory) we have
$$
V=A\ln\left(\tan\frac{\theta}{2}\right)+B
$$
 (41)

The equipotential surfaces of Eq. (41) are cones. Figure 6.11 illustrates the case where $V=0$ at $\theta=\pi/2$ and $V=V_{0}$ at $\theta=\alpha$, $\alpha<\pi/2$. We obtain
$$
V=V_{0}\frac{\ln\left(\tan\frac{\theta}{2}\right)}{\ln\left(\tan\frac{\alpha}{2}\right)}
$$
 (42)

Figure 6.11 For the cone $\theta=\alpha$ at $V_{0}$ and the plane $\theta=\pi/2$ at $V=0$, the potential field is given by $V=V_{0}[\ln(\tan\theta/2)]/[\ln(\tan\alpha/2)]$.

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

- Radial spherical symmetry produces a potential affine in $1/r$.
- The concentric-sphere capacitance is $4\pi\epsilon/(1/a-1/b)$.
- Polar-angle symmetry produces $\ln(\tan(\theta/2))$ dependence.
- Constant-$\theta$ equipotential surfaces are cones.
- The cone-plane field has only a $\mathbf{a}_\theta$ component.
- An ideal cone extending to infinity has infinite capacitance.
- Finite-cone capacitance is approximate because edge fringing is neglected.

## Source Anchors

- Equation (39) gives the concentric-sphere potential.
- Equation (40) gives the concentric-sphere capacitance.
- Equation (41) gives $V=A\ln(\tan(\theta/2))+B$.
- S1.P181.F1, Figure 6.11 shows a cone at $\theta=\alpha$ and a plane at $\theta=\pi/2$.
- Equation (42) applies $V=V_0$ on the cone and zero potential on the plane.
- The charge integral from $r=0$ to infinity diverges.
- The finite-size approximation uses $C\doteq2\pi\epsilon r_1/\ln(\cot(\alpha/2))$.

## Related Pages

- [[direct-integration-of-one-dimensional-laplace-problems|Direct Integration of One-Dimensional Laplace Problems]]
- [[potential-to-charge-capacitance-workflow|Potential-to-Charge Capacitance Workflow]]
- [[cylindrical-one-dimensional-potential-solutions|Cylindrical One-Dimensional Potential Solutions]]
- [[laplace-and-poisson-boundary-value-problem-family|Laplace and Poisson Boundary-Value Problem Family]]

## Concept Dependencies

- example-of: [[direct-integration-of-one-dimensional-laplace-problems|Direct Integration of One-Dimensional Laplace Problems]]
- applies-to: [[potential-to-charge-capacitance-workflow|Potential-to-Charge Capacitance Workflow]]
