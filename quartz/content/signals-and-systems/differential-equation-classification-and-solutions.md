---
title: "Differential Equation Classification and Solutions"
date: "2026-04-30T16:26:39.261Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "signals-and-systems-full-notes"
source_file: "Signals and Systems full notes.pdf"
locations: ["Page 43", "Page 44", "Page 45"]
related: ["direction-fields-and-physical-modeling", "first-order-linear-differential-equations", "second-order-linear-constant-coefficient-equations", "initial-value-problems-and-existence-questions"]
tags: ["differential-equation", "ode", "linearity", "general-solution", "particular-solution", "initial-conditions"]
---

## Differential Equation Classification and Solutions

Source: [[signals-and-systems-full-notes|Signals and Systems Full Notes: Sinusoids, Spectra, Sampling, Aliasing, and FIR Filters]]

Locations: Page 43, Page 44, Page 45

The notes introduce differential equations as equations relating the rate of change of a function to how it changes through space and time. Newton's second law is used as a familiar example: since acceleration can be written as $a=dv/dt$ or $a=d^2u/dt^2$, $F=ma$ becomes a differential equation such as $F(t,v)=m\,dv/dt$ or $F(t,u,du/dt)=m\,d^2u/dt^2$. Differential equations are classified as ordinary when derivatives are with respect to one variable and partial when derivatives involve multiple variables. Their order is the highest derivative appearing. A linear differential equation has the form $a_n(t)y^{(n)}(t)+a_{n-1}(t)y^{(n-1)}(t)+\cdots+a_1y'(t)+a_0y(t)=g(t)$, with no products of $y$ and its derivatives. The notes distinguish general solutions, which contain arbitrary constants and represent a family of curves, from particular solutions, which satisfy initial conditions and select one trajectory.

### Page-grounded details

#### Page 43

ACT II Systems

Chapter 1 Differential Equations:

1.1. Definitions

A differential equation, in short, is an equation relating the rate
of change of a function, or its derivative, to how it changes through
space and time.

There is one differential equation that everybody knows, that is
newtons second law of motion, which is

F = m*a

To see that this is in fact a differential equation, we need to
rewrite acceleration in one of two ways

a = dv/dt    or    a = d^2u/dt^2

Where v is the velocity of the object and u is the position function
of the object at any time t. We should also remember at this point
that the force F may also be a function of time, velocity, and/or position.

So with all those things in mind, Newton's second law can now be
written as a differential equation in terms of either the
velocity, v, or the position, u, of the object as follows.

F(t, v) = m dv/dt

F(t, u, du/dt) = m d^2u/dt^2

So that is our first differential equation.

#### Page 44

Now we introduce some terms to classify differential equations:

Ordinary: A differential equation is considered ordinary if the
derivatives taken are with respect to one variable abbreviated ODE

Partial: A differential equation is considered partial if the
derivatives taken are with respect to multiple variables & the
solution will also be written as a function of two or more
variables. These types of differential equations are out of scope
for this text

Order: The order of a differential equation is the highest
derivative taken in the equation

- Linearity: a differential equation is considered linear if it can be
written in the form where aₙ(t), aₙ₋_1(t), and g(t) are arbitrary differentiable functions

aₙ(t)y⁽ⁿ⁾(t) + aₙ₋_1(t)y⁽ⁿ⁻^1⁾(t) + ... + a_1y'(t) + a_0y(t) = g(t)   (1)

The important thing to note about linear differential equations
is that there are no products of the function y(t) and its
derivatives (Like y*y') and the coefficients are constant functions. A differential
equation that cannot be written in the form (1) is called a
non-linear differential equation, which is out of scope for this text.

- A Solution to a differential equation on the interval α < t < β is

[Truncated for analysis]

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

### Key points

- A differential equation relates derivatives to change through time or space.
- Newton's law becomes a differential equation when acceleration is written as a derivative.
- An ODE uses derivatives with respect to one variable.
- A PDE uses derivatives with respect to multiple variables.
- The order is the highest derivative in the equation.
- A particular solution is selected from a general solution using conditions.

### Related topics

- [[direction-fields-and-physical-modeling|Direction Fields and Physical Modeling]]
- [[first-order-linear-differential-equations|First-Order Linear Differential Equations]]
- [[second-order-linear-constant-coefficient-equations|Second-Order Linear Constant-Coefficient Equations]]
- [[initial-value-problems-and-existence-questions|Initial Value Problems and Existence Questions]]

### Relationships

- applies-to: [[direction-fields-and-physical-modeling|Direction Fields and Physical Modeling]]
- related: [[initial-value-problems-and-existence-questions|Initial Value Problems and Existence Questions]]
