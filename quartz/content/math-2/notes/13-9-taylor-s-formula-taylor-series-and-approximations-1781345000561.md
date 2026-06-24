---
title: "13.9 Taylor’s Formula, Taylor Series, and Approximations"
date: "2026-06-13T10:03:20.561Z"
source: "user-note"
knowledge_type: "user-note"
---

# 13.9 Taylor’s Formula, Taylor Series, and Approximations

When a function of several variables is complicated, it is often too hard to understand it exactly near every point. The immediate problem in this section is local: given a scalar function $f$ and a point near which we already know the function and its derivatives, how can we build a simpler expression that behaves almost the same as $f$ near that point? In Section 13.6, this problem was solved to first order: the linear approximation replaces a surface by its tangent plane. That is useful, but it only records the value of the function and its first rates of change. If the function bends noticeably, a tangent plane is too flat to describe the local shape well. Taylor’s formula adds higher-order derivative information so that the approximation can also include curvature.

This topic belongs here because the course has already built all the ingredients needed for it. Partial derivatives measure change in coordinate directions. Higher-order partial derivatives measure how those rates themselves change. The chain rule explains how a multivariable function changes along a path. The gradient gives the first-order directional change. Taylor’s formula combines these ideas into one local model. The first-degree Taylor polynomial is the linear approximation from Section 13.6. The second-degree Taylor polynomial adds the Hessian matrix, which contains the second partial derivatives. Higher-degree Taylor polynomials continue the same pattern.

A Taylor approximation is a polynomial approximation near a chosen base point. A polynomial is used because it is easier to evaluate, differentiate, and manipulate than most functions. In one variable, a Taylor polynomial near $x=a$ is built from the value $f(a)$, the slope $f'(a)$, the second derivative $f''(a)$, and so on. In several variables, the same idea is used, but now a point has several coordinates, and a displacement away from the point may involve changes in several directions at once.

Let $D\subseteq \mathbb{R}^d$ be a domain, meaning a set of allowed input points in $d$-dimensional space. Let

$$
f:D\to \mathbb{R}
$$

be a scalar function, meaning that each input vector in $D$ is assigned one real number. Let

$$
\mathbf{a}=(a_1,a_2,\ldots,a_d)
$$

be the point about which we expand the function. Let

$$
\mathbf{h}=(h_1,h_2,\ldots,h_d)
$$

be a small displacement vector. The point being approximated is then

$$
\mathbf{a}+\mathbf{h}=(a_1+h_1,a_2+h_2,\ldots,a_d+h_d).
$$

The vector $\mathbf{a}$ is the base point, and $\mathbf{h}$ tells us how far and in which coordinate directions we move away from that base point. The approximation is local: it is meant to be accurate when $\mathbf{h}$ is small.

![pasted 1781345708111](/math-2/assets/pasted-1781345708111.png)

The first-order approximation uses only the value and the gradient. For a function of two variables, the linear approximation near $(a,b)$ is

$$
f(a+\Delta x,b+\Delta y)
\approx
f(a,b)
+
f_x(a,b)\Delta x
+
f_y(a,b)\Delta y.
$$

Here $\Delta x=x-a$ is the change in the $x$-coordinate, $\Delta y=y-b$ is the change in the $y$-coordinate, $f_x(a,b)$ is the partial derivative with respect to $x$ evaluated at $(a,b)$, and $f_y(a,b)$ is the partial derivative with respect to $y$ evaluated at $(a,b)$. This formula says: start with the function value at the base point, then add the change predicted from moving in the $x$-direction and the change predicted from moving in the $y$-direction. This is exactly the tangent-plane approximation.

The reason this approximation can fail is not that it uses the wrong first derivative. It fails because first derivatives are themselves allowed to change as we move away from the base point. If $f_x$ and $f_y$ change quickly, the surface bends, and the tangent plane only captures the initial direction of the surface, not its curvature. The next step is therefore to include second partial derivatives.

For two variables, the second-degree Taylor polynomial near $(a,b)$ is

$$
\begin{aligned}
f(a+\Delta x,b+\Delta y)
\approx{}&
f(a,b)
+
f_x(a,b)\Delta x
+
f_y(a,b)\Delta y \\
&+
\frac{1}{2}
\left[
f_{xx}(a,b)(\Delta x)^2
+
2f_{xy}(a,b)\Delta x\Delta y
+
f_{yy}(a,b)(\Delta y)^2
\right].
\end{aligned}
$$

In this formula, $f_{xx}$ means “differentiate twice with respect to $x$,” $f_{yy}$ means “differentiate twice with respect to $y$,” and $f_{xy}$ means “differentiate first with respect to $y$ and then with respect to $x$,” or equivalently $f_{yx}$ when the mixed second partial derivatives are continuous. The terms $(\Delta x)^2$, $\Delta x\Delta y$, and $(\Delta y)^2$ are second-degree terms in the displacement. Conceptually, the first-order terms describe the tilt of the surface at the base point, while the second-order terms describe how the surface begins to bend away from the tangent plane.

The same second-order formula can be written more compactly using the Hessian matrix. The Hessian matrix of a function $f(x,y)$ is the square matrix of second partial derivatives,

$$
D^2f(a,b)=H_f(a,b)=
\begin{pmatrix}
f_{xx}(a,b) & f_{xy}(a,b)\\
f_{yx}(a,b) & f_{yy}(a,b)
\end{pmatrix}.
$$

The notation $D^2f$ means “the second derivative object of $f$,” and $H_f$ is another common notation for the same object. If the second partial derivatives are continuous near $(a,b)$, then $f_{xy}=f_{yx}$, so the Hessian is symmetric.

This also explains the identity

$$
D(\nabla f)=D^2f.
$$

The symbol $\nabla f$ is the gradient vector field. For a function of two variables,

$$
\nabla f(x,y)=
\begin{pmatrix}
f_x(x,y)\\
f_y(x,y)
\end{pmatrix}.
$$

The symbol $D(\nabla f)$ means the derivative matrix, or Jacobian matrix, of the vector field $\nabla f$. Since the first component of $\nabla f$ is $f_x$ and the second component is $f_y$, differentiating this vector field gives

$$
D(\nabla f)=
\begin{pmatrix}
\frac{\partial}{\partial x}f_x & \frac{\partial}{\partial y}f_x\\
\frac{\partial}{\partial x}f_y & \frac{\partial}{\partial y}f_y
\end{pmatrix}
=
\begin{pmatrix}
f_{xx} & f_{xy}\\
f_{yx} & f_{yy}
\end{pmatrix}
=
D^2f.
$$

So the Hessian is not a new unrelated object. It is the derivative of the gradient. Since the gradient describes first-order change, the Hessian describes how that first-order change itself changes.

Let

$$
\mathbf{h}=
\begin{pmatrix}
\Delta x\\
\Delta y
\end{pmatrix}.
$$

Then the quadratic part of the second-degree Taylor polynomial can be written as

$$
\frac{1}{2}\mathbf{h}^T D^2f(a,b)\mathbf{h}.
$$

Here $\mathbf{h}^T$ is the transpose of the column vector $\mathbf{h}$, so $\mathbf{h}^T D^2f(a,b)\mathbf{h}$ is a scalar. Multiplying it out gives

$$
\mathbf{h}^T D^2f(a,b)\mathbf{h}
=
f_{xx}(a,b)(\Delta x)^2
+
2f_{xy}(a,b)\Delta x\Delta y
+
f_{yy}(a,b)(\Delta y)^2.
$$

This identity is important because it explains the compact notation sometimes written informally as a “second directional derivative term.” The second-order part is not just a dot product with an ordinary vector. It is a quadratic form: the displacement $\mathbf{h}$ enters twice, once on each side of the Hessian. That is why the mixed term appears with coefficient $2f_{xy}$ before the outer factor $\frac12$, or equivalently with coefficient $f_{xy}$ after simplification.

For course exercises, the most important practical version is the degree-2 formula

$$
P_2(\mathbf{a}+\mathbf{h})
=
f(\mathbf{a})
+
\mathbf{h}\cdot \nabla f(\mathbf{a})
+
\frac12 \mathbf{h}^T D^2f(\mathbf{a})\mathbf{h}.
$$

In this formula, $P_2$ is the second-degree Taylor polynomial, $\mathbf{a}$ is the base point, $\mathbf{h}$ is the displacement from the base point, $\nabla f(\mathbf{a})$ is the gradient evaluated at the base point, and $D^2f(\mathbf{a})$ is the Hessian evaluated at the base point. This is the standard calculation pattern: first compute $f(\mathbf{a})$, then compute the gradient at $\mathbf{a}$, then compute the Hessian at $\mathbf{a}$, and finally substitute them into the formula.

For a function of two variables expanded near $(a,b)$, the displacement is

$$
\mathbf{h}=
\begin{pmatrix}
x-a\\
y-b
\end{pmatrix}.
$$

A common mistake is to use $x$ and $y$ themselves even when the base point is not $(0,0)$. Around $(1,2)$, the small quantities are $x-1$ and $y-2$, not $x$ and $y$. The Taylor polynomial is naturally written in powers of $x-a$ and $y-b$. A computer algebra system may expand the result into powers of $x$ and $y$, but for hand calculations the shifted form is usually clearer because it shows exactly which point the approximation is centered around.

A simple example shows the role of the Hessian clearly. Consider

$$
f(x,y)=1+x^2-y^2
$$

near $(0,0)$. The value at the origin is

$$
f(0,0)=1.
$$

The first partial derivatives are

$$
f_x(x,y)=2x,
\qquad
f_y(x,y)=-2y,
$$

so

$$
f_x(0,0)=0,
\qquad
f_y(0,0)=0.
$$

The function has no first-order change at the origin. The tangent plane is therefore horizontal. But the function is not locally flat, because the second partial derivatives are

$$
f_{xx}(x,y)=2,
\qquad
f_{xy}(x,y)=0,
\qquad
f_{yy}(x,y)=-2.
$$

Thus

$$
D^2f(0,0)=
\begin{pmatrix}
2 & 0\\
0 & -2
\end{pmatrix}.
$$

With $\mathbf{h}=(x,y)^T$, the second-degree Taylor polynomial is

$$
P_2(x,y)=
1
+
\frac12
\begin{pmatrix}x&y\end{pmatrix}
\begin{pmatrix}
2&0\\
0&-2
\end{pmatrix}
\begin{pmatrix}x\\y\end{pmatrix}.
$$

Multiplying out gives

$$
P_2(x,y)=1+x^2-y^2.
$$

In this case the second-degree Taylor polynomial is not merely an approximation; it is exactly the original function, because the original function is already a polynomial of degree two. This example also shows why second-order information is genuinely new: the gradient at the origin is zero, but the Hessian is not zero, so the local shape is determined by curvature rather than by slope.

![pasted 1781345830012](/math-2/assets/pasted-1781345830012.png)

The full multivariable Taylor formula is easiest to understand by temporarily turning the multivariable problem into a one-variable problem. Fix the base point $\mathbf{a}$ and displacement $\mathbf{h}$, and define

$$
F(t)=f(\mathbf{a}+t\mathbf{h}),
\qquad 0\leq t\leq 1.
$$

Here $t$ is a real parameter. When $t=0$, we are at the base point:

$$
F(0)=f(\mathbf{a}).
$$

When $t=1$, we are at the target point:

$$
F(1)=f(\mathbf{a}+\mathbf{h}).
$$

Thus the multivariable question “what is $f$ near $\mathbf{a}$?” becomes the one-variable question “what is $F(t)$ near $t=0$?” The path $\mathbf{a}+t\mathbf{h}$ is the straight line segment from $\mathbf{a}$ to $\mathbf{a}+\mathbf{h}$. This is why the formula requires the function to be well behaved on a region containing that line segment.

By the chain rule,

$$
F'(t)=\mathbf{h}\cdot \nabla f(\mathbf{a}+t\mathbf{h}).
$$

In this formula, $\nabla f$ is the gradient of $f$, and $\mathbf{h}\cdot \nabla f$ is the dot product between the displacement vector $\mathbf{h}$ and the gradient. If

$$
\mathbf{h}=(h_1,h_2,\ldots,h_d),
$$

then

$$
\mathbf{h}\cdot \nabla
=
h_1\frac{\partial}{\partial x_1}
+
h_2\frac{\partial}{\partial x_2}
+
\cdots
+
h_d\frac{\partial}{\partial x_d}.
$$

This expression is a differential operator. It means: take the directional change of $f$ in the direction of $\mathbf{h}$, without necessarily making $\mathbf{h}$ a unit vector. The size of $\mathbf{h}$ matters because the Taylor formula predicts the actual change caused by the displacement, not just the rate per unit distance.

Applying one-variable Taylor’s formula to $F(t)$ at $t=0$, evaluated at $t=1$, gives the multivariable Taylor formula. Suppose $f$ has continuous partial derivatives up to order $m+1$ in an open set containing the line segment from $\mathbf{a}$ to $\mathbf{a}+\mathbf{h}$. Then for some number $\theta$ with $0\leq \theta\leq 1$,

$$
f(\mathbf{a}+\mathbf{h})
=
\sum_{j=0}^{m}
\frac{(\mathbf{h}\cdot\nabla)^j f(\mathbf{a})}{j!}
+
\frac{(\mathbf{h}\cdot\nabla)^{m+1}f(\mathbf{a}+\theta\mathbf{h})}{(m+1)!}.
$$

Here $m$ is the degree up to which we keep the Taylor polynomial, $j!$ is the factorial $j!=j(j-1)\cdots 2\cdot 1$ with $0!=1$, and $(\mathbf{h}\cdot\nabla)^j$ means that the operator $\mathbf{h}\cdot\nabla$ is applied $j$ times. The term with $j=0$ is defined as simply $f(\mathbf{a})$. The final term is the remainder term. It has the same form as the next Taylor term would have, except that the derivative is evaluated at the unknown intermediate point $\mathbf{a}+\theta\mathbf{h}$ on the line segment between $\mathbf{a}$ and $\mathbf{a}+\mathbf{h}$. This is the multivariable version of the Lagrange remainder from one-variable calculus.

The finite sum

$$
P_m(\mathbf{h})
=
\sum_{j=0}^{m}
\frac{(\mathbf{h}\cdot\nabla)^j f(\mathbf{a})}{j!}
$$

is called the Taylor polynomial of degree $m$ for $f$ about $\mathbf{a}$. It is a polynomial in the components of $\mathbf{h}$. The remainder term measures what is left after replacing the function by that polynomial. Therefore Taylor’s formula is not just a recipe for approximation. It is an exact statement:

$$
f(\mathbf{a}+\mathbf{h})
=
P_m(\mathbf{h})
+
R_m(\mathbf{h}),
$$

where

$$
R_m(\mathbf{h})
=
\frac{(\mathbf{h}\cdot\nabla)^{m+1}f(\mathbf{a}+\theta\mathbf{h})}{(m+1)!}.
$$

Here $R_m(\mathbf{h})$ is the error made by using $P_m(\mathbf{h})$ instead of the exact function value.

A practical way to express the same idea is to use big-$O$ notation. We write

$$
f(\mathbf{a}+\mathbf{h})
=
f(\mathbf{a})
+
\mathbf{h}\cdot\nabla f(\mathbf{a})
+
\frac{(\mathbf{h}\cdot\nabla)^2f(\mathbf{a})}{2!}
+
\cdots
+
\frac{(\mathbf{h}\cdot\nabla)^m f(\mathbf{a})}{m!}
+
O(|\mathbf{h}|^{m+1})
\quad \text{as } \mathbf{h}\to \mathbf{0}.
$$

The symbol $|\mathbf{h}|$ means the length of the displacement vector. The notation $O(|\mathbf{h}|^{m+1})$ means that the omitted error is bounded in size by a constant times $|\mathbf{h}|^{m+1}$ when $\mathbf{h}$ is sufficiently small. This is useful because it tells us the order of the error without requiring us to know the exact unknown point $\mathbf{a}+\theta\mathbf{h}$. A second-degree Taylor approximation has an error of order $|\mathbf{h}|^3$, provided the required third-order derivatives behave well.

The Taylor series is the infinite version of the Taylor polynomial. If the function is smooth, meaning that all required partial derivatives exist and are continuous, and if the remainder terms tend to zero as the degree grows, then

$$
f(\mathbf{a}+\mathbf{h})
=
\sum_{j=0}^{\infty}
\frac{(\mathbf{h}\cdot\nabla)^j f(\mathbf{a})}{j!}.
$$

This formula is called the Taylor series of $f$ about $\mathbf{a}$. The Taylor polynomial is a finite approximation. The Taylor series is an infinite expansion. The Taylor formula is the exact finite expansion together with a remainder. These three terms should not be confused. A Taylor polynomial can be useful even when we do not know whether the infinite Taylor series converges to the function. A Taylor series represents the function only where the remainder tends to zero.

When the base point is the origin, the Taylor series is often called a Maclaurin series. For a function of two variables, expanding about $(0,0)$ means writing the function in powers of $x$ and $y$. Expanding about $(a,b)$ means writing it in powers of $x-a$ and $y-b$. This distinction matters. A Taylor polynomial near $(1,2)$ should naturally be written in powers of $x-1$ and $y-2$, because those are the small quantities near the base point.

Consider the function

$$
f(x,y)=\sqrt{x^2+y^3}
$$

near the point $(1,2)$. At this point,

$$
f(1,2)=\sqrt{1^2+2^3}=3.
$$

Let

$$
h=x-1,
\qquad
k=y-2.
$$

The variables $h$ and $k$ are the small changes in $x$ and $y$ from the base point. The first partial derivatives are

$$
f_x(x,y)=\frac{x}{\sqrt{x^2+y^3}},
\qquad
f_y(x,y)=\frac{3y^2}{2\sqrt{x^2+y^3}}.
$$

At $(1,2)$, these become

$$
f_x(1,2)=\frac13,
\qquad
f_y(1,2)=2.
$$

The second partial derivatives evaluated at $(1,2)$ are

$$
f_{xx}(1,2)=\frac{8}{27},
\qquad
f_{xy}(1,2)=-\frac{2}{9},
\qquad
f_{yy}(1,2)=\frac{2}{3}.
$$

Therefore the second-degree Taylor polynomial is

$$
P_2(h,k)
=
3
+
\frac13 h
+
2k
+
\frac12
\left[
\frac{8}{27}h^2
+
2\left(-\frac29\right)hk
+
\frac23 k^2
\right].
$$

Simplifying gives

$$
P_2(h,k)
=
3
+
\frac13 h
+
2k
+
\frac{4}{27}h^2
-
\frac29 hk
+
\frac13 k^2.
$$

This formula is useful because it gives quick numerical approximations near $(1,2)$. For example,

$$
\sqrt{(1.02)^2+(1.97)^3}
=
f(1+0.02,2-0.03),
$$

so

$$
h=0.02,
\qquad
k=-0.03.
$$

Substituting these values into the Taylor polynomial gives

$$
\begin{aligned}
f(1.02,1.97)
\approx{}&
3
+
\frac13(0.02)
+
2(-0.03)
+
\frac{4}{27}(0.02)^2 \\
&-
\frac29(0.02)(-0.03)
+
\frac13(-0.03)^2.
\end{aligned}
$$

This gives approximately

$$
2.9471593.
$$

The sign of $k$ is important: since $1.97=2-0.03$, the linear $y$-contribution is $2(-0.03)$, not $2(0.03)$. Many errors in Taylor approximation come from expanding around the correct point but then using the wrong displacement signs.

Taylor polynomials can also be found by algebraic manipulation of known one-variable series. This is often faster than computing many partial derivatives. The key idea is to rewrite the function in terms of small shifted variables. Suppose we want to expand

$$
f(x,y)=e^{x-2y}
$$

near $(1,2)$. Let

$$
u=x-1,
\qquad
v=y-2.
$$

Then $x=1+u$ and $y=2+v$. Substituting gives

$$
x-2y=(1+u)-2(2+v)=-3+u-2v.
$$

Thus

$$
e^{x-2y}=e^{-3}e^u e^{-2v}.
$$

Now $u$ and $v$ are small near $(1,2)$. Using the one-variable expansion

$$
e^t=1+t+\frac{t^2}{2!}+\frac{t^3}{3!}+\cdots,
$$

we get

$$
e^u=1+u+\frac{u^2}{2}+\cdots
$$

and

$$
e^{-2v}=1-2v+2v^2+\cdots.
$$

Multiplying these and keeping only terms up to degree two gives

$$
e^{x-2y}
\approx
e^{-3}
\left(
1+u-2v+\frac12u^2-2uv+2v^2
\right).
$$

Returning to $x$ and $y$, this becomes

$$
e^{x-2y}
\approx
e^{-3}
\left[
1+(x-1)-2(y-2)
+\frac12(x-1)^2
-2(x-1)(y-2)
+2(y-2)^2
\right].
$$

This method avoids differentiating repeatedly. The important rule is to keep only the terms whose total degree is needed. The total degree of a term is the sum of the powers of its variables. For example, $u^2v$ has total degree three, because the powers add to $2+1=3$. A second-degree Taylor polynomial keeps constant, first-degree, and second-degree terms, but discards all terms of total degree three or higher.

The same degree-counting idea explains a common trap in second-order Taylor approximations. Consider

$$
f(x,y)=\sin(1+xy)
$$

near $(0,0)$. Since $xy$ already has total degree two, the expression $1+xy$ differs from $1$ only by a second-degree quantity. Using the one-variable expansion of $\sin$ around $1$, with $s=xy$, gives

$$
\sin(1+s)=\sin(1)+\cos(1)s+\text{higher-order terms in }s.
$$

Since $s=xy$, this becomes

$$
\sin(1+xy)=\sin(1)+\cos(1)xy+\text{terms of degree four and higher}.
$$

There are no linear terms, and there are no $x^2$ or $y^2$ terms. Therefore the second-degree Taylor approximation is

$$
P_2(x,y)=\sin(1)+\cos(1)xy.
$$

The Hessian confirms this. The first partial derivatives are

$$
f_x(x,y)=y\cos(1+xy),
\qquad
f_y(x,y)=x\cos(1+xy),
$$

so both vanish at $(0,0)$. The second partial derivatives at the origin are

$$
f_{xx}(0,0)=0,
\qquad
f_{yy}(0,0)=0,
\qquad
f_{xy}(0,0)=\cos(1).
$$

Thus

$$
D^2f(0,0)=
\begin{pmatrix}
0 & \cos(1)\\
\cos(1) & 0
\end{pmatrix}.
$$

The determinant of this Hessian is

$$
\det D^2f(0,0)=0\cdot 0-\cos(1)\cos(1)=-\cos^2(1).
$$

Also,

$$
\frac12
\begin{pmatrix}x&y\end{pmatrix}
\begin{pmatrix}
0 & \cos(1)\\
\cos(1) & 0
\end{pmatrix}
\begin{pmatrix}x\\y\end{pmatrix}
=
\cos(1)xy.
$$

This example is useful because it separates two ideas that are easy to mix up. The term $xy$ is second degree, not first degree. Also, the mixed derivative $f_{xy}$ contributes to the coefficient of $xy$, not to separate $x$- and $y$-linear terms.

Some Taylor-series problems involve functions defined by integrals. The method is not to try to find an elementary antiderivative if none is available. Instead, expand the integrand as a power series, integrate that series term by term, and then substitute the expression that appears in the upper limit.

Consider

$$
f(x,y)=\int_0^{x+y^2} e^{t^2}\,dt
$$

near $(0,0)$. The upper limit

$$
s=x+y^2
$$

is small when $x$ and $y$ are close to zero. The one-variable Maclaurin series for the exponential function is

$$
e^z=1+z+\frac{z^2}{2!}+\frac{z^3}{3!}+\cdots.
$$

Using $z=t^2$, we get

$$
e^{t^2}=1+t^2+\frac{t^4}{2!}+\frac{t^6}{3!}+\cdots.
$$

Now integrate from $0$ to $s$:

$$
\int_0^s e^{t^2}\,dt
=
\int_0^s
\left(
1+t^2+\frac{t^4}{2!}+\frac{t^6}{3!}+\cdots
\right)\,dt.
$$

This gives

$$
\int_0^s e^{t^2}\,dt
=
s+\frac{s^3}{3}+\frac{s^5}{5\cdot 2!}+\frac{s^7}{7\cdot 3!}+\cdots.
$$

Substituting $s=x+y^2$, we obtain

$$
f(x,y)
=
(x+y^2)
+
\frac{(x+y^2)^3}{3}
+
\frac{(x+y^2)^5}{5\cdot 2!}
+\cdots.
$$

If only the second-degree Taylor polynomial is needed, we keep only terms of total degree at most two. The expression $x+y^2$ already contains the first-degree term $x$ and the second-degree term $y^2$. The next term, $\frac{(x+y^2)^3}{3}$, has lowest possible total degree three because it begins with $x^3$. Therefore the second-degree Taylor polynomial is

$$
P_2(x,y)=x+y^2.
$$

This example illustrates a general principle. When a function is built from a known power series and a multivariable expression, first identify the small expression, then expand, substitute, and keep only terms of the required total degree.

Taylor approximation also gives a way to approximate functions that are defined implicitly. An implicit equation relates variables without necessarily solving explicitly for one of them. For example, an equation of the form

$$
F(x,y)=0
$$

may define $y$ as a function of $x$ near a point, even if there is no simple formula for $y=f(x)$. If the implicit function theorem guarantees that such a function exists, Taylor series can approximate it.

Consider the equation

$$
\sin(x+y)=xy+2x.
$$

We want a solution of the form

$$
y=f(x)
$$

near $x=0$, with

$$
f(0)=0.
$$

Because the solution passes through $(0,0)$, we look for a Maclaurin series

$$
y=a_1x+a_2x^2+a_3x^3+a_4x^4+\cdots.
$$

There is no constant term because $y=f(0)=0$. Substituting this series into the equation allows us to determine the coefficients one by one. First,

$$
x+y=(1+a_1)x+a_2x^2+a_3x^3+a_4x^4+\cdots.
$$

Using

$$
\sin z=z-\frac{z^3}{3!}+\cdots,
$$

and keeping terms up to degree four, we get

$$
\sin(x+y)
=
(1+a_1)x
+
a_2x^2
+
\left[
a_3-\frac16(1+a_1)^3
\right]x^3
+
\left[
a_4-\frac12(1+a_1)^2a_2
\right]x^4
+\cdots.
$$

The right-hand side is

$$
xy+2x
=
x(a_1x+a_2x^2+a_3x^3+a_4x^4+\cdots)+2x,
$$

so

$$
xy+2x=2x+a_1x^2+a_2x^3+a_3x^4+\cdots.
$$

Now equal powers of $x$ must have equal coefficients. From the coefficient of $x$,

$$
1+a_1=2,
$$

so

$$
a_1=1.
$$

From the coefficient of $x^2$,

$$
a_2=a_1,
$$

so

$$
a_2=1.
$$

From the coefficient of $x^3$,

$$
a_3-\frac16(1+a_1)^3=a_2.
$$

Since $a_1=1$ and $a_2=1$, this becomes

$$
a_3-\frac{8}{6}=1,
$$

so

$$
a_3=\frac73.
$$

From the coefficient of $x^4$,

$$
a_4-\frac12(1+a_1)^2a_2=a_3.
$$

Substituting $a_1=1$, $a_2=1$, and $a_3=\frac73$, we obtain

$$
a_4-2=\frac73,
$$

so

$$
a_4=\frac{13}{3}.
$$

Therefore the implicit solution has the approximation

$$
y=f(x)=x+x^2+\frac73x^3+\frac{13}{3}x^4+\cdots.
$$

This method works because a Taylor series is determined by matching coefficients. Instead of solving the implicit equation exactly, we solve for the coefficients of the local series. The result is not a global formula for $y$; it is a local approximation near the point where the series is constructed.

A final point is worth emphasizing. Taylor approximation is not a separate trick from the earlier material. It is a compressed way of organizing local derivative information. The constant term gives the function value. The linear terms give the tangent-plane approximation and are controlled by the gradient. The quadratic terms are controlled by the Hessian and describe the first bending away from the tangent plane. Higher-order terms continue this process by measuring more subtle changes in the lower-order behavior. The Taylor polynomial is the usable finite approximation; the remainder explains its error; and the Taylor series is the infinite expansion that represents the function only when the remainders vanish. Together, these ideas turn local derivative data into a practical model of a multivariable function near a point.
