---
title: "Non-Homogeneous Second-Order Equations"
date: "2026-04-30T16:26:39.261Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "signals-and-systems-full-notes"
source_file: "Signals and Systems full notes.pdf"
locations: ["Page 61", "Page 62"]
related: ["characteristic-equation-and-root-cases", "homogeneous-and-particular-solutions-as-affine-spaces", "second-order-linear-constant-coefficient-equations"]
tags: ["non-homogeneous-equations", "variation-of-parameters", "ansatz", "resonance", "forcing-term"]
---

## Non-Homogeneous Second-Order Equations

Source: [[signals-and-systems-full-notes|Signals and Systems Full Notes: Sinusoids, Spectra, Sampling, Aliasing, and FIR Filters]]

Locations: Page 61, Page 62

Non-homogeneous second-order equations have the form $L[y]=f(t)$, or $ay''(t)+by'(t)+cy(t)=f(t)$. The notes describe a solution method based on first finding the homogeneous solution of $ay''+by'+cy=0$, then finding a particular solution $y_p$ based on the shape of the forcing term. The method uses ansatz forms: a constant forcing suggests a constant $A$, a polynomial $x^n$ suggests a polynomial of degree $n$, an exponential $e^{kt}$ suggests $Ae^{kt}$, and trigonometric or product terms require combinations involving sine, cosine, polynomials, and exponentials. The complete solution follows the same structure as earlier: $y(t)=\operatorname{Ker}(L)+y_p$. The notes warn about resonance: if the guessed particular solution is part of the homogeneous solution, multiply the ansatz by $x$ so it does not lie in $\operatorname{Ker}(L)$. They also state that for sums of forcing functions, make separate particular guesses and add them.

### Page-grounded details

#### Page 61

2) The non-homogeneous equations: L[y] = f(t)

Now consider the forced equation

ay''(t) + by'(t) + cy(t) = f(t).

To solve these types OB DE's we use a method called variation of parameters
which has the following solution algorithm:

(1) we find the solution to the homogeneous part ay''(t) + by'(t) + cy(t) = 0

(2) we find the particular solution yp based on what f(t) is, meaning,
we make an ansatz according to the table

Non-homogeneous term. | Form of Particular solution, Yp
C | A
xⁿ | Aₙxⁿ + Aₙ₋_1xⁿ⁻^1 + ... + A_0
eᵏᵗ | Aeᵏᵗ
sin(bt) or cos(bt) | (Aₙxⁿ + ... + A_0)eᵏᵗ
xⁿsin(bt) or xⁿcos(bt) | (Aₙxⁿ + ... + A_0)cos(bt) + (Bₙxⁿ + ... + B_0)sin(bt)

This is the same technique we used in first order Ode's, and the same logic is as:
y(t) = Ker(L) + yp However there are some caveats and things to consider

1) Resonance: if yp is or a part of the homogeneous solution multiply your
ansatz by x. So that the particular solution doesn't lie in Ker(L) and is
a new direction.

2) Multiples: if you have ay'' + by' + cy = f(x)g(x), then multiply the
ansatz of each.

3) Additivity: if you have ay'' + by' + cy = f(x) + g(x) + h(x) then make
particular guesses for each and add them.

#### Page 62

! It is very important to note that the variation of parameters method only
works when the forcing term has a nice form eg:

- Polynomials

- Exponentials

- Sines and cosines

- Products of above

Finally the system representation clarifies why initial value problems are naturally
posed with two conditions for a second order equation, specifying y(t_0) and y'(t_0).
For the non homogeneous system [Ẋ] = AX + G(t), specifying y(t_0) and y'(t_0)
is exactly specifying the initial state x(t_0) ∈ R^2

Chapter 2: Modeling Systems

2.1 Continous LTI systems

Engineering is fundamentally the science of transforming signals. A signal,
in continuous time domain is a function of time that carries information and is
defined everywhere. In a new while a system is a physical or computational
mechanism that manipulates the signal. Because physical systems evolve in
time and store energy, they cause memory. Such systems are called dynamical
systems and their behaviour is described by differential equations.

In this notebook, we focus on single-input single-output (SISO) continuous
time linear invariant systems, because they admit a powerful mathematical
theory that allows prediction design and co

[Truncated for analysis]

### Key points

- The forced second-order equation is $ay''+by'+cy=f(t)$.
- First solve the homogeneous equation.
- Then choose a particular-solution ansatz based on $f(t)$.
- The total solution is the homogeneous solution plus $y_p$.
- If the ansatz overlaps the homogeneous solution, multiply by $x$.
- For additive forcing terms, add the corresponding particular guesses.

### Related topics

- [[characteristic-equation-and-root-cases|Characteristic Equation and Root Cases]]
- [[homogeneous-and-particular-solutions-as-affine-spaces|Homogeneous and Particular Solutions as Affine Spaces]]
- [[second-order-linear-constant-coefficient-equations|Second-Order Linear Constant-Coefficient Equations]]

### Relationships

- depends-on: [[characteristic-equation-and-root-cases|Characteristic Equation and Root Cases]]
- depends-on: [[homogeneous-and-particular-solutions-as-affine-spaces|Homogeneous and Particular Solutions as Affine Spaces]]
