---
title: "Separable Differential Equations"
date: "2026-04-30T16:26:39.261Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "signals-and-systems-full-notes"
source_file: "Signals and Systems full notes.pdf"
locations: ["Page 49", "Page 50"]
related: ["first-order-linear-differential-equations", "homogeneous-and-particular-solutions-as-affine-spaces"]
tags: ["separable-differential-equations", "homogeneous", "integrating-factor", "first-order-differential-equations"]
---

## Separable Differential Equations

Source: [[signals-and-systems-full-notes|Signals and Systems Full Notes: Sinusoids, Spectra, Sampling, Aliasing, and FIR Filters]]

Locations: Page 49, Page 50

A separable differential equation is a first-order equation that can be written as $dy/dx=a(x)b(y)$, allowing all $y$ terms to be collected on one side and all $x$ terms on the other. The notes express the separated form as $\frac{1}{b(y)}dy=a(x)dx$, after which both sides can be integrated. The example $dy/dx=y\sqrt{1+x}$ is separated by dividing by $y$ and multiplying by $dx$, giving $\frac{1}{y}dy=\sqrt{1+x}\,dx$. Integration gives $\ln(y)=\frac{2}{3}(x+1)^{3/2}+C$, and exponentiation yields $y=Ce^{\frac{2}{3}(x+1)^{3/2}}$. The notes also show that this same equation is first-order linear and homogeneous when written as $dy/dx-y\sqrt{1+x}=0$, and solving by an integrating factor produces the same result.

### Page-grounded details

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

#### Page 50

12/ Solve the differential equation  dy/dx = y√(1+x)

solution - immediately we notice that there is only one term that consists
of a function of y times a function of x. So, this differential equation
is most likely separable.

        1   dy
        - * -- = √(1+x)
        y   dx

now we can multiply dx by both sides

        1
        - dy = √(1+x) dx
        y

integrate

        ∫ 1/y dy = ∫ √(1+x) dx

        ∴ ln(y) = 2/3 (x+1)^(3/2) + C

Lastly, we can solve for y by exponentiating both sides to obtain
our general solution.

        y = C e^(2/3 (x+1)^(3/2))

This is indeed our solution, however note that we could have
skipped the separation if we'd moved the term on the right hand side
over.

        dy/dx - y√(1+x) = 0.

You may notice two things: this is linear and q(x)=0, meaning it's
called homogeneous (more on that a bit later). Which has the form

        dy/dx - P(x)y = 0

Let μ(x)=e^(∫p(x)dx) = e^(-∫√(1+x) dx)
        = e^(-2/3(1+x)^(3/2))

        ∴ y e^(-2/3(1+x)^(3/2)) = C

        ∴ y = C e^(2/3(1+x)^(3/2))

57

### Key points

- A separable equation has form $dy/dx=a(x)b(y)$.
- Variables are separated as $\frac{1}{b(y)}dy=a(x)dx$.
- The example $dy/dx=y\sqrt{1+x}$ is separable.
- Dividing by $y$ gives $\frac{1}{y}dy=\sqrt{1+x}\,dx$.
- Integration gives $\ln(y)=\frac{2}{3}(x+1)^{3/2}+C$.
- The general solution is $y=Ce^{\frac{2}{3}(x+1)^{3/2}}$.

### Related topics

- [[first-order-linear-differential-equations|First-Order Linear Differential Equations]]
- [[homogeneous-and-particular-solutions-as-affine-spaces|Homogeneous and Particular Solutions as Affine Spaces]]

### Relationships

- related: [[first-order-linear-differential-equations|First-Order Linear Differential Equations]]
