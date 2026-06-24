---
title: "First-Order Linear Differential Equations"
date: "2026-04-30T16:26:39.261Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "signals-and-systems-full-notes"
source_file: "Signals and Systems full notes.pdf"
locations: ["Page 47", "Page 48", "Page 49"]
related: ["initial-value-problems-and-existence-questions", "separable-differential-equations", "homogeneous-and-particular-solutions-as-affine-spaces"]
tags: ["first-order-differential-equations", "linear-differential-equations", "integrating-factor", "general-solution"]
---

## First-Order Linear Differential Equations

Source: [[signals-and-systems-full-notes|Signals and Systems Full Notes: Sinusoids, Spectra, Sampling, Aliasing, and FIR Filters]]

Locations: Page 47, Page 48, Page 49

A first-order differential equation involves an unknown function and its first derivative. The notes first present the direct-integration form $dy/dx=f(x)$, where the slope depends on the independent variable, and solve $dy/dx=e^x$ by integration to get $y(x)=e^x+C$. They then define the first-order linear form $y'+p(x)y=q(x)$ and solve it with an integrating factor. The integrating factor is $\mu(x)=e^{\int p(x)dx}$, and multiplying the equation by $\mu$ converts the left side into $d(y\mu)/dx=q(x)\mu(x)$. The motion example $dv/dt+0.196v=9.8$ has integrating factor $e^{0.196t}$ and solution $v=50+Ce^{-0.196t}$. This method demonstrates how a nonhomogeneous first-order linear equation can be solved systematically.

### Page-grounded details

#### Page 47

Before diving into differential equations, it is important to ask
the three fundamental questions (very similar to linear algebra).

1) Existence: Does a solution exist? Some differential equations have no solutions.

2) Uniqueness: If a solution exists, is it unique? In physical systems, our calc.
models should produce identical outcomes. If a differential equation admits
multiple general solutions, we would not know which one represents reality.
Therefore, we use conditions and guarantees a single, unique solution.

3) Solvability: Even if a solution exists and is unique, can we actually find it?
Some differential equations cannot be solved (closed form), even though solutions exist.

12 First Order Differential Equations:

- A first-order differential equation is an equation that involves an unknown
function and its first derivative. Such equations arise whenever a quantity
changes at a rate that depends on the current state of a system. Although
first-order equations can be many forms, three classes occur so frequently
in mathematics, physics and engineering that they are treated as fundamental.

1) General first order equations

dy
dx = f(x)

This is the most general form of a

[Truncated for analysis]

#### Page 48

2 Linear differential Equations

In the last chapter, we learning how to identify and classify them. So
a first order differential equation takes the form

y' + p(x)y = q(x)  (1)

which have an easy algorithm to solve

1/ Let μ(x) = e^∫p(x)dx and call it the integrating factor, multiplying
both sides of (1) by μ(x) yields

d(y * μ(x))
────────── = q(x) * μ(x)
dx

and integrating both sides:

∫ d(y*μ(x))
  ───────── dx = ∫ q(x) μ(x) dx + C
      dx

down ex) Take the differential equation for motion slope slide example dv/dt = 9.8 - 0.196v
     Solve it using the integrating factor method.

down

Solution: Put it in the general form (1),

∴ dv/dt + 0.196v = 9.8       ; μ(x) = e^∫0.196dt = e^0.196t

∴ (v * e^0.196t)' = 9.8 * e^0.196t

∴ v e^0.196t = ∫ 9.8e^0.196t dt

(integrating longer without c results c same thing)

v e^0.196t = 9.8/0.196 * e^0.196t + C

v e^0.196t = 50 e^0.196t + C

v = 50 e^0.196t / e^0.196t + C / e^0.196t

= 50 + C e^-0.196t

55

#### Page 49

1/ solve the IVP    dv/dt = 9.8 - 0.196v    with v(0)=48.

Solution: To find the solution to an IVP, we must first find first the
solution to the differential equation and then use the initial condition to
[unclear]. By the work solution we are after. From the previous example,
we already have the general solution

        v = 50 + Ce^-0.196t

Now to find the solution we are after, we need to decide [unclear] the value
of C that will give us the solution we are after. To do this, we simply
plug in the initial condition which will give us an equation we can solve for
C, so let's do this.

        v(0)=48        v(0)=50+Ce^-0.196*0

        ∴ 48 = 50 + C

        ∴ C = -2

So the actual solution to the IVP is

        v = 50 - 2e^-0.196t


3) Separable differential equations:

We are now going to look at the more important case which are called
first order differential equations. The only case we will look at is the
separable differential equation which can actually be rare but most of separable
matters aren't so let's just annoying convention. For a differential equation
written in the form

        dy/dx = a(x)b(y)

We can separate the variables by collecting all x terms on one sid

[Truncated for analysis]

### Key points

- A first-order differential equation contains a first derivative.
- The form $dy/dx=f(x)$ can be solved by direct integration.
- A first-order linear equation has form $y'+p(x)y=q(x)$.
- The integrating factor is $\mu(x)=e^{\int p(x)dx}$.
- Multiplying by $\mu$ turns the left side into $d(y\mu)/dx$.
- $dv/dt+0.196v=9.8$ solves to $v=50+Ce^{-0.196t}$.

### Related topics

- [[initial-value-problems-and-existence-questions|Initial Value Problems and Existence Questions]]
- [[separable-differential-equations|Separable Differential Equations]]
- [[homogeneous-and-particular-solutions-as-affine-spaces|Homogeneous and Particular Solutions as Affine Spaces]]

### Relationships

- applies-to: [[initial-value-problems-and-existence-questions|Initial Value Problems and Existence Questions]]
