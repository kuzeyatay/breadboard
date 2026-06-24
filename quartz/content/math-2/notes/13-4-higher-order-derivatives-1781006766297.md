---
title: "13.4 Higher-Order Derivatives"
date: "2026-06-09T12:06:06.297Z"
source: "user-note"
knowledge_type: "user-note"
---

# 13.4 Higher-Order Derivatives

In the previous section, partial derivatives were introduced as the natural extension of ordinary derivatives to functions with more than one input variable. If $z=f(x,y)$, then $f_x(x,y)$ measures how $f$ changes when only $x$ is varied, and $f_y(x,y)$ measures how $f$ changes when only $y$ is varied. This gives first-order information: it tells us the slope of the graph in the coordinate directions and allows us to describe tangent planes and normal lines.

That information is not always enough. Once we know the slope in a given direction, we may also want to know how that slope itself changes. In one-variable calculus this led from $f'(x)$ to $f''(x)$. For functions of several variables the same idea appears, but with more possibilities. After differentiating once with respect to one variable, we may differentiate again with respect to the same variable or with respect to a different variable. Higher-order partial derivatives are introduced to measure these repeated changes.

A higher-order derivative is a derivative obtained by differentiating a derivative. A second-order partial derivative is obtained by differentiating a first partial derivative. If $z=f(x,y)$, then there are four possible second-order partial derivatives, because the first differentiation can be with respect to $x$ or $y$, and the second differentiation can again be with respect to $x$ or $y$.

The two derivatives in which the same variable is used twice are called pure second partial derivatives. They are

$$
f_{xx}(x,y)=\frac{\partial^2 f}{\partial x^2}(x,y)
=\frac{\partial}{\partial x}\left(\frac{\partial f}{\partial x}\right)(x,y),
$$

and

$$
f_{yy}(x,y)=\frac{\partial^2 f}{\partial y^2}(x,y)
=\frac{\partial}{\partial y}\left(\frac{\partial f}{\partial y}\right)(x,y).
$$

Here $f_{xx}$ means: first differentiate $f$ with respect to $x$, obtaining $f_x$, and then differentiate $f_x$ again with respect to $x$. It measures how the $x$-direction slope changes as we move in the $x$-direction. Similarly, $f_{yy}$ measures how the $y$-direction slope changes as we move in the $y$-direction.

The two derivatives in which both variables are used are called mixed second partial derivatives. They are

$$
f_{xy}(x,y)=\frac{\partial}{\partial y}\left(\frac{\partial f}{\partial x}\right)(x,y),
$$

and

$$
f_{yx}(x,y)=\frac{\partial}{\partial x}\left(\frac{\partial f}{\partial y}\right)(x,y).
$$

The order matters in the definition. In $f_{xy}$, the subscript closest to $f$ is $x$, so the first differentiation is with respect to $x$. Then we differentiate the result with respect to $y$. Thus $f_{xy}$ measures how the $x$-direction slope changes as $y$ changes. In $f_{yx}$, we first differentiate with respect to $y$, and then with respect to $x$. Thus $f_{yx}$ measures how the $y$-direction slope changes as $x$ changes. These two descriptions are related, but they are not the same definition.

The numbered-subscript notation is useful when a function has many variables. If

$$
f=f(x_1,x_2,\ldots,x_d),
$$

then

$$
f_i=\frac{\partial f}{\partial x_i}
$$

means the first partial derivative with respect to the $i$-th variable. A second-order partial derivative is written as

$$
f_{ij}=\frac{\partial}{\partial x_j}\left(f_i\right).
$$

This means: first differentiate with respect to $x_i$, then differentiate the result with respect to $x_j$. For example, if $x_1=x$ and $x_2=y$, then

$$
f_{12}=f_{xy},
\qquad
f_{21}=f_{yx}.
$$

The notation $f_{12}$ therefore means “first variable first, second variable second,” while $f_{21}$ means the opposite order.

For example, let

$$
f(x,y)=x^3y^4.
$$

The first partial derivatives are

$$
f_x(x,y)=3x^2y^4,
\qquad
f_y(x,y)=4x^3y^3.
$$

Now we differentiate these first partial derivatives again. Differentiating $f_x$ with respect to $x$ gives

$$
f_{xx}(x,y)=6xy^4.
$$

Differentiating $f_x$ with respect to $y$ gives

$$
f_{xy}(x,y)=12x^2y^3.
$$

Differentiating $f_y$ with respect to $x$ gives

$$
f_{yx}(x,y)=12x^2y^3.
$$

Differentiating $f_y$ with respect to $y$ gives

$$
f_{yy}(x,y)=12x^3y^2.
$$

Thus, in this example,

$$
f_{xy}(x,y)=f_{yx}(x,y).
$$

This equality is common for the smooth functions that appear most often in calculations, but it should not be assumed blindly. It depends on a condition that will be stated shortly.

The same process works for functions of three variables. Suppose

$$
f(x,y,z)=e^{3x+4y}\sin(5z).
$$

Here $x$, $y$, and $z$ are independent variables. Differentiating with respect to $x$ affects only the factor $e^{3x+4y}$, and each $x$-derivative contributes a factor $3$. Therefore,

$$
f_x=3e^{3x+4y}\sin(5z),
\qquad
f_{xx}=9e^{3x+4y}\sin(5z).
$$

Similarly, each $y$-derivative contributes a factor $4$, so

$$
f_y=4e^{3x+4y}\sin(5z),
\qquad
f_{yy}=16e^{3x+4y}\sin(5z).
$$

Differentiating with respect to $z$ affects only $\sin(5z)$. The first derivative is $5\cos(5z)$, and the second derivative is $-25\sin(5z)$. Hence

$$
f_z=5e^{3x+4y}\cos(5z),
\qquad
f_{zz}=-25e^{3x+4y}\sin(5z).
$$

This example already shows why second partial derivatives are useful: they can be combined to test whether a function satisfies certain equations. Here,

$$
\begin{aligned}
f_{xx}+f_{yy}+f_{zz}
&=9e^{3x+4y}\sin(5z)+16e^{3x+4y}\sin(5z)-25e^{3x+4y}\sin(5z).
\end{aligned}
$$

The coefficients add to zero:

$$
9+16-25=0.
$$

Therefore,

$$
f_{xx}+f_{yy}+f_{zz}=0.
$$

This is a three-dimensional Laplace equation. At this stage, the important point is not to solve such an equation from scratch, but to understand how second partial derivatives allow us to check whether a given function satisfies it.

Higher-order derivatives may also involve more than two differentiations. If

$$
f=f(x,y,z),
$$

then an expression such as

$$
f_{223}
$$

means that we differentiate first with respect to the second variable, then again with respect to the second variable, and then with respect to the third variable. If $x_1=x$, $x_2=y$, and $x_3=z$, then $f_{223}$ means first $y$, then $y$, then $z$.

For example, let

$$
f(x,y,z)=e^{x-2y+3z}.
$$

To compute $f_{223}$, we first differentiate with respect to $y$:

$$
f_2=-2e^{x-2y+3z}.
$$

Differentiating again with respect to $y$ gives

$$
f_{22}=4e^{x-2y+3z}.
$$

Differentiating this result with respect to $z$ gives

$$
f_{223}=12e^{x-2y+3z}.
$$

If instead we compute $f_{232}$, we differentiate with respect to $y$, then $z$, then $y$. The result is again

$$
f_{232}=12e^{x-2y+3z}.
$$

For this smooth exponential function, the order of these differentiations does not change the answer.

![pasted 1781007433944](/math-2/assets/pasted-1781007433944.png)

The theorem that explains when mixed partial derivatives may be interchanged is called Clairaut’s theorem, also known as Schwarz’s theorem. In the second-order case, it says that if $f_{xy}$ and $f_{yx}$ are continuous near a point $(a,b)$, then

$$
f_{xy}(a,b)=f_{yx}(a,b).
$$

The condition is not merely that both mixed partial derivatives exist at the point. The theorem requires enough continuity near the point. Intuitively, $f_{xy}$ and $f_{yx}$ compare the same small rectangular change in two different orders: first $x$ then $y$, or first $y$ then $x$. If the relevant derivatives vary continuously, then as the rectangle shrinks to the point, the two ways of measuring the change approach the same value.

This condition matters. There are piecewise-defined functions for which both $f_{xy}(0,0)$ and $f_{yx}(0,0)$ exist but are not equal, because the mixed partial derivatives fail to behave continuously near the origin. Such examples are not typical computational examples, but they explain why the theorem includes a continuity assumption. For ordinary polynomials, exponentials, trigonometric functions, and logarithmic functions on regions where they are smoothly defined, the condition is normally satisfied.

The same principle extends to higher-order derivatives. If all relevant higher partial derivatives are continuous, then the order of differentiation can be rearranged without changing the final result, as long as each variable is used the same number of times. For instance, if the relevant third-order derivatives are continuous, then

$$
f_{223}=f_{232}=f_{322}.
$$

Each expression differentiates twice with respect to the second variable and once with respect to the third variable. The order is different, but the differentiations used are the same.

A common practical task is to compute all second partial derivatives of a function. Consider

$$
f(x,y)=xe^y-ye^x.
$$

The first partial derivatives are

$$
f_x=e^y-ye^x,
\qquad
f_y=xe^y-e^x.
$$

Now differentiate again. From $f_x=e^y-ye^x$, differentiating with respect to $x$ gives

$$
f_{xx}=-ye^x.
$$

Differentiating $f_x$ with respect to $y$ gives

$$
f_{xy}=e^y-e^x.
$$

From $f_y=xe^y-e^x$, differentiating with respect to $x$ gives

$$
f_{yx}=e^y-e^x.
$$

Differentiating $f_y$ with respect to $y$ gives

$$
f_{yy}=xe^y.
$$

Thus,

$$
f_{xy}=f_{yx}=e^y-e^x.
$$

This example is useful because it separates two types of second derivative. The pure derivatives $f_{xx}$ and $f_{yy}$ measure repeated change in one coordinate direction. The mixed derivatives $f_{xy}$ and $f_{yx}$ measure how one coordinate slope changes when the other coordinate changes.

When functions contain roots, logarithms, or quotients, the domain must be checked before interpreting the derivatives. For example,

$$
f(x,y)=\sqrt{3x^2+y^2}
$$

is defined for all $(x,y)\in\mathbb{R}^2$, because $3x^2+y^2\geq 0$. However, the expression under the square root is zero at $(0,0)$, and derivatives involving division by $\sqrt{3x^2+y^2}$ may fail to exist or fail to be continuous there. Thus “the formula is defined” and “all second partial derivatives behave nicely” are different questions. Higher-order derivative problems often require attention not only to formal differentiation, but also to where the resulting expressions are valid.

The most important partial differential equation in this section is the Laplace equation. In two variables it is

$$
\frac{\partial^2 z}{\partial x^2}
+
\frac{\partial^2 z}{\partial y^2}
=0.
$$

Here $z=z(x,y)$ is the unknown function, and $x$ and $y$ are independent variables. The equation says that the sum of the pure second partial derivatives in the two coordinate directions is zero. A function with continuous second partial derivatives that satisfies this equation on a region is called harmonic on that region.

The word “harmonic” does not mean that the function is periodic or sinusoidal. It means that the function satisfies Laplace’s equation. Harmonic functions appear in steady-state models, such as temperature distributions with no internal heat sources, and in potential fields. In this section, the main skill is verification: compute $z_{xx}$, compute $z_{yy}$, add them, and check whether the sum is zero.

For example, let

$$
z=e^{kx}\cos(ky),
$$

where $k$ is a real constant. First differentiate with respect to $x$:

$$
z_x=ke^{kx}\cos(ky),
$$

and again:

$$
z_{xx}=k^2e^{kx}\cos(ky).
$$

Next differentiate with respect to $y$:

$$
z_y=-ke^{kx}\sin(ky),
$$

and again:

$$
z_{yy}=-k^2e^{kx}\cos(ky).
$$

Adding the two pure second partial derivatives gives

$$
\begin{aligned}
z_{xx}+z_{yy}
&=k^2e^{kx}\cos(ky)-k^2e^{kx}\cos(ky)\\
&=0.
\end{aligned}
$$

Therefore $z=e^{kx}\cos(ky)$ is harmonic on the entire $xy$-plane. The related function $z=e^{kx}\sin(ky)$ is checked in the same way: differentiating twice with respect to $x$ produces a positive $k^2$ factor, while differentiating twice with respect to $y$ produces the corresponding negative term, so the sum cancels.

Another important family of harmonic functions is

$$
u(x,y)=A(x^2-y^2)+Bxy,
$$

where $A$ and $B$ are constants. The first partial derivatives are

$$
u_x=2Ax+By,
\qquad
u_y=-2Ay+Bx.
$$

The second pure partial derivatives are

$$
u_{xx}=2A,
\qquad
u_{yy}=-2A.
$$

Therefore,

$$
u_{xx}+u_{yy}=2A-2A=0.
$$

So $u$ is harmonic on all of $\mathbb{R}^2$. Notice that the term $Bxy$ contributes no pure second derivative, because differentiating $Bxy$ twice with respect to $x$ gives zero, and differentiating it twice with respect to $y$ also gives zero.

A second course-relevant harmonic example is

$$
u(x,y)=\ln(x^2+y^2).
$$

This function is not defined at $(0,0)$, because $\ln(0)$ is undefined. Its natural domain is therefore

$$
\mathbb{R}^2\setminus\{(0,0)\}.
$$

On this domain,

$$
u_x=\frac{2x}{x^2+y^2},
\qquad
u_y=\frac{2y}{x^2+y^2}.
$$

Differentiating again gives

$$
u_{xx}=\frac{2(y^2-x^2)}{(x^2+y^2)^2},
$$

and

$$
u_{yy}=\frac{2(x^2-y^2)}{(x^2+y^2)^2}.
$$

Adding these two expressions gives

$$
\begin{aligned}
u_{xx}+u_{yy}
&=\frac{2(y^2-x^2)}{(x^2+y^2)^2}
+
\frac{2(x^2-y^2)}{(x^2+y^2)^2}\\
&=0.
\end{aligned}
$$

Thus $\ln(x^2+y^2)$ is harmonic everywhere except at the origin. The exclusion of the origin is essential. A function cannot be harmonic at a point where it is not even defined.

Another important example is

$$
u(x,y)=\tan^{-1}\left(\frac{y}{x}\right).
$$

This expression is defined where $x\neq 0$, so one may work on a region such as $x>0$ or $x<0$. The first partial derivatives are

$$
u_x=-\frac{y}{x^2+y^2},
\qquad
u_y=\frac{x}{x^2+y^2}.
$$

Differentiating again gives

$$
u_{xx}=\frac{2xy}{(x^2+y^2)^2},
\qquad
u_{yy}=-\frac{2xy}{(x^2+y^2)^2}.
$$

Therefore,

$$
u_{xx}+u_{yy}=0.
$$

So $\tan^{-1}(y/x)$ is harmonic on regions where the formula is smoothly defined. This example is a good reminder that verifying Laplace’s equation is not only about differentiating correctly; the domain must also be stated correctly.

A compact way to generate harmonic functions comes from the Cauchy–Riemann equations. Suppose $u=u(x,y)$ and $v=v(x,y)$ are functions with continuous second partial derivatives and satisfy

$$
u_x=v_y,
\qquad
u_y=-v_x.
$$

These two equations are called the Cauchy–Riemann equations. In this course section, they are used only as a relation between partial derivatives; no complex analysis is needed.

To show that $u$ is harmonic, differentiate the first equation $u_x=v_y$ with respect to $x$. This gives

$$
u_{xx}=v_{yx}.
$$

Differentiate the second equation $u_y=-v_x$ with respect to $y$. This gives

$$
u_{yy}=-v_{xy}.
$$

Adding the two results gives

$$
u_{xx}+u_{yy}=v_{yx}-v_{xy}.
$$

Because the relevant second partial derivatives are continuous, Clairaut’s theorem gives

$$
v_{yx}=v_{xy}.
$$

Therefore,

$$
u_{xx}+u_{yy}=0.
$$

So $u$ is harmonic. A similar calculation shows that $v$ is harmonic. From $v_x=-u_y$, differentiating with respect to $x$ gives

$$
v_{xx}=-u_{yx}.
$$

From $v_y=u_x$, differentiating with respect to $y$ gives

$$
v_{yy}=u_{xy}.
$$

Adding gives

$$
v_{xx}+v_{yy}=-u_{yx}+u_{xy}=0,
$$

again using equality of mixed partials. Thus both functions satisfying the Cauchy–Riemann equations are harmonic, provided the needed second partial derivatives are continuous.

![pasted 1781007459497](/math-2/assets/pasted-1781007459497.png)

The other major partial differential equation in this section is the one-dimensional wave equation:

$$
\frac{\partial^2 w}{\partial t^2}
=
c^2\frac{\partial^2 w}{\partial x^2}.
$$

Here $w=w(x,t)$ is a function of position $x$ and time $t$, and $c$ is a constant wave speed. The left-hand side $w_{tt}$ measures second-order change in time at a fixed position. The right-hand side $c^2w_{xx}$ measures spatial bending, scaled by $c^2$. The equation says that the time acceleration of the wave profile is controlled by its spatial curvature.

Let $f$ and $g$ be twice-differentiable functions of one variable, and define

$$
w(x,t)=f(x-ct)+g(x+ct).
$$

The expression $f(x-ct)$ represents a shape travelling to the right when $c>0$. To see why, keep the input $x-ct$ constant. If $t$ increases, then $x$ must also increase to keep $x-ct$ unchanged. Similarly, $g(x+ct)$ represents a shape travelling to the left, because keeping $x+ct$ constant requires $x$ to decrease as $t$ increases.

To verify the wave equation, first differentiate $w$ with respect to $t$. Since $f$ and $g$ are one-variable functions, the ordinary chain rule gives

$$
w_t(x,t)=-c f'(x-ct)+c g'(x+ct).
$$

Differentiating again with respect to $t$ gives

$$
w_{tt}(x,t)=c^2f''(x-ct)+c^2g''(x+ct).
$$

Now differentiate $w$ with respect to $x$:

$$
w_x(x,t)=f'(x-ct)+g'(x+ct).
$$

Differentiating again with respect to $x$ gives

$$
w_{xx}(x,t)=f''(x-ct)+g''(x+ct).
$$

Multiplying by $c^2$ gives

$$
c^2w_{xx}(x,t)=c^2f''(x-ct)+c^2g''(x+ct).
$$

This is exactly the expression for $w_{tt}$. Therefore,

$$
w_{tt}=c^2w_{xx}.
$$

So every function of the form

$$
w(x,t)=f(x-ct)+g(x+ct)
$$

satisfies the one-dimensional wave equation, as long as $f$ and $g$ have enough derivatives for the calculation to make sense.

At this point, it is helpful to separate the present section from the next uses of the same objects. In this section, second-order partial derivatives are introduced as derivatives of derivatives. The main tasks are to compute them, read the notation correctly, know when mixed partial derivatives may be interchanged, and use them to verify equations such as the Laplace and wave equations. Later, the same second partial derivatives are arranged into a matrix called the Hessian matrix. For a function $f=f(x,y)$, the Hessian matrix is

$$
D^2f(x,y)=
\begin{pmatrix}
f_{xx}(x,y) & f_{xy}(x,y)\\
f_{yx}(x,y) & f_{yy}(x,y)
\end{pmatrix}.
$$

This matrix is not a new kind of derivative. It is simply an organized table of the second partial derivatives. Its full use belongs to later material on local approximation and Taylor formulas, but the entries of the matrix are exactly the derivatives introduced here. Therefore, when a problem asks for the determinant of the Hessian matrix, the first step is still the same: compute $f_{xx}$, $f_{xy}$, $f_{yx}$, and $f_{yy}$ carefully.

For example, if

$$
f(x,y)=\sin(1+xy),
$$

then

$$
f_x=y\cos(1+xy),
\qquad
f_y=x\cos(1+xy).
$$

The second pure partial derivatives are

$$
f_{xx}=-y^2\sin(1+xy),
\qquad
f_{yy}=-x^2\sin(1+xy).
$$

The mixed partial derivative is

$$
\begin{aligned}
f_{xy}
&=\frac{\partial}{\partial y}\left(y\cos(1+xy)\right)\\
&=\cos(1+xy)-xy\sin(1+xy).
\end{aligned}
$$

By continuity of the relevant second partial derivatives,

$$
f_{yx}=f_{xy}.
$$

At $(0,0)$, these become

$$
f_{xx}(0,0)=0,
\qquad
f_{yy}(0,0)=0,
\qquad
f_{xy}(0,0)=f_{yx}(0,0)=\cos(1).
$$

Thus

$$
D^2f(0,0)=
\begin{pmatrix}
0 & \cos(1)\\
\cos(1) & 0
\end{pmatrix}.
$$

The determinant is

$$
\begin{aligned}
\det D^2f(0,0)
&=0\cdot 0-\cos(1)\cos(1)\\
&=-\cos^2(1).
\end{aligned}
$$

This example belongs naturally at the boundary of this section: it uses only second partial derivatives and equality of mixed partials, but it also prepares the notation that will appear later in approximation problems.

The central idea of higher-order derivatives is therefore a direct extension of first partial derivatives. First partial derivatives measure how a function changes in a coordinate direction. Second partial derivatives measure how those rates of change themselves change. Pure second partial derivatives repeat the same coordinate direction, while mixed partial derivatives compare changes across different coordinate directions. When the relevant derivatives are continuous, mixed partial derivatives can be interchanged. This fact simplifies calculations and makes it possible to express important equations, such as the Laplace equation and the wave equation, in terms of second partial derivatives.
