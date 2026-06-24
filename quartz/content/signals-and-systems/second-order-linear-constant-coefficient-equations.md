---
title: "Second-Order Linear Constant-Coefficient Equations"
date: "2026-04-30T16:26:39.261Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "signals-and-systems-full-notes"
source_file: "Signals and Systems full notes.pdf"
locations: ["Page 54", "Page 55"]
related: ["homogeneous-and-particular-solutions-as-affine-spaces", "mass-spring-damper-phase-plane", "characteristic-equation-and-root-cases"]
tags: ["second-order-differential-equations", "constant-coefficients", "forcing-function", "linear-system", "differential-operator"]
---

## Second-Order Linear Constant-Coefficient Equations

Source: [[signals-and-systems-full-notes|Signals and Systems Full Notes: Sinusoids, Spectra, Sampling, Aliasing, and FIR Filters]]

Locations: Page 54, Page 55

Second-order differential equations model systems involving acceleration, curvature, or second-order response, such as mechanical vibrations, electrical circuits, and wave motion. The notes focus on second-order linear constant-coefficient equations of the form $ay''(t)+by'(t)+cy(t)=f(t)$, where $a,b,c$ are constants and $f(t)$ is a forcing function. In operator form, $L[y]=ay''+by'+cy$, and $f(t)=L[y]$, giving an input-output interpretation analogous to $A\vec{x}=\vec{b}$ in linear algebra. The homogeneous case is $ay''+by'+cy=0$. The notes show that this scalar equation can be rewritten as a first-order linear system by setting $z(t)=y'(t)$ and $\vec{X}(t)=[y(t),z(t)]^T$. The resulting system is $\vec{X}'(t)=A\vec{X}(t)$ with $A=\begin{bmatrix}0&1\\-c/a&-b/a\end{bmatrix}$.

### Page-grounded details

#### Page 54

13. Second Order Differential Equations:

Second order differential equations arise whenever we model a dynamical
system that involves acceleration, curvature, or any kind of second
order response, such as mechanical vibrations, electrical circuits
or wave motion. A second order linear differential equation with constant
coefficients (which is the only type we will look at) has the general form

a y''(t) + b y'(t) + c y(t) = f(t)

Where a, b, c are constants and f(t) is called a forcing function.
The structure of this equation is best understood through the linear algebra
view:

[boxed] L[y] = a y'' + b y' + c y

∴ [boxed] f(t) = L[y]     (1)

If we were to model a system, the equation (1) expresses the entire
input-output structure of the system where y(t) is the output
(what the system does), L is the system and f(t) is the input. This
is the linear algebra equivalent of A x⃗ = b⃗ where x ↔ y(t), A ↔ L[ ]
b ↔ f(t)

In this chapter we study only two types of second order ordinary
differential equations: 1) The homogeneous constant coefficient equation and the
non homogeneous constant coefficient.

1) The homogeneous equation L[y] = 0

The guiding idea is that a second order scalar

[Truncated for analysis]

#### Page 55

Make the 2nd order system

\[
\begin{cases}
\frac{d}{dt}z(t)-\frac{c}{a}y(t)=z'(t)\\
z(t)=y'(t)
\end{cases}
\]

Writing:

\[
\begin{bmatrix}
0 & 1\\
-\frac{c}{a} & -\frac{b}{a}
\end{bmatrix}
\begin{bmatrix}
y(t)\\
z(t)
\end{bmatrix}
=
\begin{bmatrix}
z(t)\\
y''(t)
\end{bmatrix}
\tag{2}
\]

If \((y(t), z(t))\) satisfies the system and \(z(t)=y'(t)\), then \(z'(t)=y''(t)\)
and then substituting:

\[
z'(t)=-\frac{b}{a}z(t)-\frac{c}{a}y(t)
\]

\[
\therefore\ y''(t)=-\frac{b}{a}y'(t)-\frac{c}{a}y(t)
\]

\[
\therefore\ ay''(t)=-by'(t)-cy(t)
\]

\[
\therefore\ ay''(t)+by'(t)+cy(t)=0
\]

Lets go back to (2) and define it properly

\[
\text{Let }\vec{X}(t)=
\begin{bmatrix}
y(t)\\
z(t)
\end{bmatrix}
\text{ then } [\vec{X}(t)]'=
\begin{bmatrix}
y'(t)\\
z'(t)
\end{bmatrix}
=
\begin{bmatrix}
z(t)\\
-\frac{c}{a}y(t)-\frac{b}{a}z(t)
\end{bmatrix}
\]

\[
=
\begin{bmatrix}
0 & 1\\
-\frac{c}{a} & -\frac{b}{a}
\end{bmatrix}
\vec{X}(t)
\]

\[
\therefore\ \text{we have the linear system}
\]

\[
[\vec{X}(t)]'=A\vec{X}(t),\quad
A=
\begin{bmatrix}
0 & 1\\
-\frac{c}{a} & -\frac{b}{a}
\end{bmatrix}
\]

### Key points

- Second-order equations arise in acceleration, curvature, vibrations, circuits, and waves.
- The constant-coefficient form is $ay''+by'+cy=f(t)$.
- $f(t)$ is called a forcing function.
- The operator form is $L[y]=ay''+by'+cy$.
- The homogeneous equation is $ay''+by'+cy=0$.
- Using $z=y'$ converts the equation into a first-order system in $\mathbb{R}^2$.

### Related topics

- [[homogeneous-and-particular-solutions-as-affine-spaces|Homogeneous and Particular Solutions as Affine Spaces]]
- [[mass-spring-damper-phase-plane|Mass-Spring-Damper Phase Plane]]
- [[characteristic-equation-and-root-cases|Characteristic Equation and Root Cases]]

### Relationships

- related: [[homogeneous-and-particular-solutions-as-affine-spaces|Homogeneous and Particular Solutions as Affine Spaces]]
