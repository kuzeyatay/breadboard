---
title: "Characteristic Equation and Root Cases"
date: "2026-04-30T16:26:39.261Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "signals-and-systems-full-notes"
source_file: "Signals and Systems full notes.pdf"
locations: ["Page 57", "Page 58", "Page 59", "Page 60"]
related: ["second-order-linear-constant-coefficient-equations", "mass-spring-damper-phase-plane", "non-homogeneous-second-order-equations"]
tags: ["characteristic-equation", "eigenvalue-equation", "discriminant", "repeated-roots", "complex-roots"]
---

## Characteristic Equation and Root Cases

Source: [[signals-and-systems-full-notes|Signals and Systems Full Notes: Sinusoids, Spectra, Sampling, Aliasing, and FIR Filters]]

Locations: Page 57, Page 58, Page 59, Page 60

The notes derive the characteristic equation for a second-order homogeneous constant-coefficient ODE using the system form $\vec{X}'=A\vec{X}$ and the ansatz $\vec{X}(t)=e^{rt}\vec{v}$. Differentiation gives $\vec{X}'=re^{rt}\vec{v}$, while the system gives $A\vec{X}=Ae^{rt}\vec{v}$. Canceling $e^{rt}$ produces the eigenvalue equation $A\vec{v}=r\vec{v}$. With $A=\begin{bmatrix}0&1\\-c/a&-b/a\end{bmatrix}$, the determinant condition $\det(A-rI)=0$ becomes $r^2+(b/a)r+c/a=0$, or $ar^2+br+c=0$. The discriminant $\Delta=b^2-4ac$ determines three solution cases. For $\Delta>0$, two distinct real roots produce $y=C_1e^{r_1t}+C_2e^{r_2t}$. For $\Delta=0$, the repeated-root solution is $y=C_1e^{rt}+C_2te^{rt}$. For complex roots $r=\alpha\pm i\beta$, the real solution is $y=e^{\alpha t}(C_1\cos\beta t+C_2\sin\beta t)$.

### Page-grounded details

#### Page 57

Now lets take a look at how solutions are formed. Consider the
order scalar homogeneous equation

a_1y′(t) + a_2y(t) = 0,  a_1 != 0

-> y′(t) + a_2/a_1 y(t) = 0

which is a separable equation and a linear one with y(x) = e^∫(a_2/a_1)dt = e^(a_2/a_1)t

- Its homogeneous solution is C_1e^rt where r = -a_2/a_1

We must now state that exponentials have a great property; they are the
functions whose derivative is a scalar multiple of themselves. Hence they are
named the only eigenfunctions of the derivative operator.

Now give the same representation idea to the matrix system [X⃗]′ = A X⃗
In one dimension, the constant a_2/a_1 multiplies the state. In R^2, the matrix A is a
linear map that multiplies the state.

[ -a_2/a_1 ][ y(t) ] = [ y′(t) ] ⇔ A * X⃗ = [X⃗]′
10-D

We therefore look for solutions whose derivative is a constant linear
map applied to themselves, and we represent those again as exp in time but now with a constant direction vector.

Let y(x) = C_1e^rt and y′(x) = C_1re^rt then,

X⃗(t) = [ C_1e^rt ]
        [ C_1re^rt ] = e^rt [ C_1 ]
                             [ C_1r ] and the constant C_1 is just a scalar multiplying

the vector, so v⃗ ∝ [ 1 ]
                     [ r

[Truncated for analysis]

#### Page 58

\[
(A\vec{v})e^{rt}=r\vec{v}e^{rt}
\]

cancel \(e^{rt}\) to obtain the purely algebraic condition:

\[
A\vec{v}=r\vec{v}
\]

This is precisely the eigenvalue equation; to find the eigenvectors that
satisfy the system, use the characteristic equation

\[
\det(A-rI)=0
\]

\[
A=
\begin{bmatrix}
0 & 1\\
-\frac{c}{a} & -\frac{b}{a}
\end{bmatrix},
\quad
A-rI=
\begin{bmatrix}
-r & 1\\
-\frac{c}{a} & -\frac{b}{a}-r
\end{bmatrix}
\]

and

\[
\det(A-rI)=(-r)\left(-\frac{b}{a}-r\right)-1\left(-\frac{c}{a}\right)
=r\left(\frac{b}{a}+r\right)+\frac{c}{a}
=r^2+\frac{b}{a}r+\frac{c}{a}
\]

so \(\det(A-rI)\) becomes:

\[
r^2+\frac{b}{a}r+\frac{c}{a}=0
\]

Multiplying by \(a\) gives:

\[
ar^2+br+c=0
\]

This is called the characteristic equation of the second order ode.
Once the roots are found, one obtains the solution by solving
\[
(A-rI)\vec{v}=0
\]
To determine the roots of the characteristic
equation we use the discriminant formula:

\[
\frac{-b\pm\sqrt{\Delta}}{2a}
\quad \text{where} \quad
\Delta=b^2-4ac
\]

Now we have three separate cases for \(\Delta\).

1) [boxed] \(\Delta>0\). Then \(r_1\) and \(r_2\) are two distinct solutions to the
differential equation therefore we have two eigenvalu

[Truncated for analysis]

#### Page 59

then the two solutions are:

\(\vec{x}_1(t)=\vec{v}_1 e^{r_1 t}, \quad \vec{x}_2(t)=\vec{v}_2 e^{r_2 t}.\)

Because the system is linear and these two vectors are linearly independent, any linear combination \(\alpha \vec{x}_1+\beta \vec{x}_2\) is again a solution. Taking the 2nd coordinate of \(\vec{x}(t)\) yields the corresponding solution \(y(t)\) of the second order ODE.

∴ the (homogeneous) solution is
\(y(t)=C_1 e^{r_1 t}+C_2 e^{r_2 t}.\)

2) [boxed] \(D=0\)

means we have \(r_1=r_2=r\) which is called "repeated roots" where
\(y_1(t)=e^{rt}\) satisfies the equation. You may realize that this is the case algebraic multiplicity != geometric multiplicity case. A second order homogeneous equation always has a two-dimensional solution space so one solution cannot be the case.

The natural idea is to keep the same exponential \(e^{rt}\) and multiply it by the simplest new factor that could produce linear independence enough. We therefore test: \(y_2(t)=t e^{rt}\).

Let \(L[y]=y''+py'+qy.\) \((a=1)\)

∴ \(L[t e^{rt}]=\{t(r^2+pr+q)+(2r+p)\}e^{rt}\)

When \(r\) is a repeated root, both

\(r^2+pr+q=0\) and \(2r+p=0\)

hold; Therefore,

\(L[t e^{rt}]=0\)

so \(y_2(t)=t e^{rt}\) is indee

[Truncated for analysis]

#### Page 60

3) [△○] means complex roots of the form r_1,_2 = α ± iβ we may know

y(t) = e^(α+iβ)t is a solution

e^(α+iβ)t = e^(αt) e^(iβt) = e^(αt)(Cos(βt) + iSin(βt))

are independent. so the general solution is

y(t) = e^(αt)(C_1 cos(βt) + C_2 sin(βt)).


(c) Find the solution to the initial value problem;

{
y'' + 6y' + 9y = 0
y(0) = 1
y'(0) = 2
}


Solution

(1) characteristic equation;

r^2 + 6r + 9 = 0     (r + 3)^2 = 0 , r = -3 with multiplicity 2

(2) General solution;

y(x) = C_1e^(-3x) + C_2xe^(-3x)

(3) Apply initial values.

y'(x) = -3C_1e^(-3x) + C_2(e^(-3x) - 3xe^(-3x))

y'(0) = -3C_1 + C_2(1+0) = -3 + C_2 = 2
C_2 = 5

| y(0) = C_1 + C_2 0 = 1 , C_1 = 1

∴ The solution to the IVP is  y(x) = e^(-3x) + 5xe^(-3x).

### Key points

- The exponential ansatz is $\vec{X}(t)=e^{rt}\vec{v}$.
- Substitution gives the eigenvalue equation $A\vec{v}=r\vec{v}$.
- The characteristic condition is $\det(A-rI)=0$.
- For $ay''+by'+cy=0$, the characteristic equation is $ar^2+br+c=0$.
- The discriminant is $\Delta=b^2-4ac$.
- Distinct real, repeated, and complex roots give different homogeneous solution forms.

### Related topics

- [[second-order-linear-constant-coefficient-equations|Second-Order Linear Constant-Coefficient Equations]]
- [[mass-spring-damper-phase-plane|Mass-Spring-Damper Phase Plane]]
- [[non-homogeneous-second-order-equations|Non-Homogeneous Second-Order Equations]]

### Relationships

- applies-to: [[second-order-linear-constant-coefficient-equations|Second-Order Linear Constant-Coefficient Equations]]
- applies-to: [[mass-spring-damper-phase-plane|Mass-Spring-Damper Phase Plane]]
