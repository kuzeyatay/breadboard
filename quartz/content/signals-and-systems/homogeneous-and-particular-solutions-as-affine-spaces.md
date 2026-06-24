---
title: "Homogeneous and Particular Solutions as Affine Spaces"
date: "2026-04-30T16:26:39.261Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "signals-and-systems-full-notes"
source_file: "Signals and Systems full notes.pdf"
locations: ["Page 51", "Page 52", "Page 53"]
related: ["first-order-linear-differential-equations", "initial-value-problems-and-existence-questions", "second-order-linear-constant-coefficient-equations"]
tags: ["linear-differential-operator", "homogeneous-solution", "particular-solution", "affine-space", "kernel"]
---

## Homogeneous and Particular Solutions as Affine Spaces

Source: [[signals-and-systems-full-notes|Signals and Systems Full Notes: Sinusoids, Spectra, Sampling, Aliasing, and FIR Filters]]

Locations: Page 51, Page 52, Page 53

The notes reinterpret first-order linear differential equations using linear-operator language from linear algebra. For $y'(t)+p(t)y(t)=q(t)$, define $L[y]=y'(t)+p(t)y(t)$, so the equation becomes $L[y]=q(t)$. The operator is linear because $L[c_1y_1+c_2y_2]=c_1L[y_1]+c_2L[y_2]$. The homogeneous equation is $L[y_h]=0$, analogous to $A\vec{x}=\vec{0}$ and the null space of a matrix. A particular solution satisfies $L[y_p]=q(t)$, analogous to one solution of $A\vec{x}=\vec{b}$. The complete solution is $y_c(t)=y_p(t)+y_h(t)$, meaning the solution set is an affine space: a translated copy of the homogeneous solution space. An IVP then acts as a constraint selecting one curve from that affine family.

### Page-grounded details

#### Page 51

A first order linear differential equation has the form

y'(t) + p(t)y(t) = q(t)

Now define the linear differential operator of order 1

[ L[y] := y'(t) + p(t).y(t) ]     [ de i.e. L[y] = q(t) ]

It is proven to be linear because,

L[c_1y_1 + c_2y_2] = c_1L[y_1] + c_2L[y_2]

This is the same structural pattern as linear algebra. In linear alg, define a linear system is A x⃗ = b⃗ where A is a linear map. Here L plays the role of A, the unknown function y plays the role of x, and forcing q plays the role of b

Now recall that a homogeneous system in linear algebra had the form A x = 0⃗. The differential equation analogous to that is:

L[y] := 0

∴ y'(t) + p(t).y(t) = 0

is called a first order linear homogeneous differential equation. We can say that, let yₕ be the homogeneous solution:

L[yₕ] = 0 ⇔ yₕ'(t) + p(t).yₕ(t) = 0

In linear algebra language, lives in the null space (kernel) of the linear operator L. Just as A x = 0 describes the nullspace of a matrix A, the equation L[y] = 0 describes the nullspace of the differential operator.

Now consider, the particular solution, A particular solution is any function satisfying

L[yₚ] = q(t)

In linear algebra, any solution xₚ to A x⃗

[Truncated for analysis]

#### Page 52

The differential equation behaves identically

yc(t) = yp(t) + yh(t)

This means that the set of all solutions is an affine space which is
a translated copy of the homogeneous solution-space

[diagram: coordinate axes with several parallel slanted lines/planes indicating a family of general solutions. A line/plane through the origin is labeled "L[yh] = 0". A shifted parallel set is labeled "affine span" and "= y0? = yh + yp" [unclear]. A vector/arrow from the homogeneous solution toward the shifted solution is labeled "yp". Text near the upper slanted family reads "family of general solutions".]

The general solution is then y = yp + yh
which is the due vectoring yp . . .

An initial value problem plays the role of
a constraint that picks one specific curve
from this affine space

ex/ Solving  dv/dt = 9.8 - 0.196v  using yn + yp  and  v(0) = 48

Solution, rewriting in the standard form yields

        dv/dt + 0.196v = 9.8

∴ L[v] = v′(t) + 0.196v(t)

First solve the homogeneous part

        V′h + 0.196 Vh = 0

seperate

        V′h / Vh = -0.196        =  1/Vh * dVh/dt = -0.196

        1/Vh * dVh = -0.196 dt

∴ Vh(t) = Ce^(-0.196t)

#### Page 53

Now calculate the particular solution

v'(t) + 0.196 v(t) = 9.8

Because right hand side is a constant, we can make a clever guess of the
solution often referred to as ansatz (and which we will see more in detail in
other courses) is to try a constant particular solution.

Let vp(t) = K, then v'p(t)=0 and substituting into the ode gives

0 + 0.196K = 9.8  ->  K = 9.8/0.196 = 50

∴ vp(t) = 50


Now we can add them and

v(t) = vh(t) + vp(t) = 50 + Ce^-0.196t

Now applying v(0)=48 which is just selecting one curve of the general
solution family.

50 + Ce^0 = 48,  C = -2

∴ v(t)=50-2e^-0.196t


Linearity of Solutions: Now again consider the homogeneous equation L(y)=0
if y1 and y2 are solutions then,

L[y1]=0,  L[y2]=0

By linearity of L

L[ay1 + by2] = a*0 + b*0 = 0

∴ The linear combinations of independent solutions to a homogeneous differential
equation yh1 + yh2 + yh3 + ... yhₙ are also solutions to the differential
equation.

60

### Key points

- The first-order linear operator is $L[y]=y'(t)+p(t)y(t)$.
- The equation $L[y]=q(t)$ parallels $A\vec{x}=\vec{b}$.
- The homogeneous equation is $L[y_h]=0$.
- The homogeneous solution space is analogous to the null space.
- A particular solution satisfies $L[y_p]=q(t)$.
- The full solution has form $y_c(t)=y_p(t)+y_h(t)$.

### Related topics

- [[first-order-linear-differential-equations|First-Order Linear Differential Equations]]
- [[initial-value-problems-and-existence-questions|Initial Value Problems and Existence Questions]]
- [[second-order-linear-constant-coefficient-equations|Second-Order Linear Constant-Coefficient Equations]]

### Relationships

- applies-to: [[first-order-linear-differential-equations|First-Order Linear Differential Equations]]
- related: [[initial-value-problems-and-existence-questions|Initial Value Problems and Existence Questions]]
