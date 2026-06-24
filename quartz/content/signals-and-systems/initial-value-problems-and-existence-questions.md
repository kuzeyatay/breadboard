---
title: "Initial Value Problems and Existence Questions"
date: "2026-04-30T16:26:39.261Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "signals-and-systems-full-notes"
source_file: "Signals and Systems full notes.pdf"
locations: ["Page 45", "Page 46", "Page 47", "Page 49"]
related: ["differential-equation-classification-and-solutions", "first-order-linear-differential-equations", "homogeneous-and-particular-solutions-as-affine-spaces"]
tags: ["initial-value-problem", "initial-conditions", "existence", "uniqueness", "solvability"]
---

## Initial Value Problems and Existence Questions

Source: [[signals-and-systems-full-notes|Signals and Systems Full Notes: Sinusoids, Spectra, Sampling, Aliasing, and FIR Filters]]

Locations: Page 45, Page 46, Page 47, Page 49

An initial value problem combines a differential equation with enough initial conditions to determine a specific solution. The notes state that a differential equation describes a family of curves, and the initial condition selects which curve represents the physical system. For an order-$n$ differential equation, $n$ initial conditions are required. The material frames differential equations through three fundamental questions: existence, uniqueness, and solvability. Existence asks whether any solution exists, uniqueness asks whether the solution is the only one compatible with the conditions, and solvability asks whether the solution can actually be found in closed form. This is important in physical modeling because models should produce identical outcomes from the same conditions. The notes also use the IVP $dv/dt=9.8-0.196v$ with $v(0)=48$ to select $C=-2$ from the general solution $v=50+Ce^{-0.196t}$, giving $v=50-2e^{-0.196t}$.

### Page-grounded details

#### Page 45

general solution of a differential equation after substituting the given
initial conditions which "selects" one unique trajectory from the infinite
family of solutions defined by the differential equation.

Initial Conditions are a condition, or set of conditions, on the solution
that will allow us to determine which solution we are after.

∫ ex/ let y(x) = x^(3/2) be a solution to 2x^2y'' + 12xy' + 3y = 0 with { y(0) = 1/4 and y(4) = 1
                                                initial
                                                conditions

an initial value problem (IVP) is a differential equation along with an
appropriate number of initial conditions. therefore, for a differential equation
with order n, you need n initial conditions.

=> Direction Fields:

- Direction fields are important because they let us understand how
solutions to a differential equation behave without seeing it. They
show us the slope of the general solution at every point and allow us
to sketch solution curves and analyze long term behaviour.

Differential equations arise naturally when modeling physical systems.
the process of translating a physical situation into a differential equation
is calle

[Truncated for analysis]

#### Page 46

, Now set, dϑ/dt = 0, ... 9.8 - 0.196ϑ = 0  =>  ϑ = 50. We can see that when ϑ = 50, the
slope of f(ϑ) is zero, which looks like: y

[graph: vertical axis labeled f(ϑ); horizontal axis labeled t. A dashed horizontal line at value 50 extends across the graph with arrows pointing right along it.]

, If we were to try to find a general solution
to this differential equation, we would
try to find an expression for ϑ(t). This
graph gives the slope at each solution
since we don't actually which for even
question looks like:

[boxed equation] ϑ(t) = 50 + Ce^-0.196t

- for ϑ < 50, dϑ/dt > 0 meaning
velocity increases (since up)

for ϑ > 50, dϑ/dt < 0 meaning velocity
decreases

[direction field graph: vertical axis with marks labeled 50 and 30; horizontal axis labeled t. Many small arrows/slopes fill the rectangular field. The arrows below 50 tilt upward/right, near 50 are nearly horizontal, and above 50 tilt downward/right. A thick solution curve starts at ϑ(0)=30 and rises toward 50, flattening as t increases.]

- Full slope field of f(ϑ)
for vector for curve
choose ϑ(0)=30. We now find
a C such that

[arrow pointing down from "a C such that"]

Solution Curve for ϑ(0)=30
looks like this

[Truncated for analysis]

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

- An IVP is a differential equation plus suitable initial conditions.
- An order-$n$ differential equation requires $n$ initial conditions.
- Initial conditions select one curve from a family of solutions.
- Existence asks whether a solution exists.
- Uniqueness asks whether the solution is single and determined.
- Solvability asks whether a solution can be found explicitly.

### Related topics

- [[differential-equation-classification-and-solutions|Differential Equation Classification and Solutions]]
- [[first-order-linear-differential-equations|First-Order Linear Differential Equations]]
- [[homogeneous-and-particular-solutions-as-affine-spaces|Homogeneous and Particular Solutions as Affine Spaces]]

