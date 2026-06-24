---
title: "MATHEMATICS 2 — FINAL EXAM FORMULA + CONCEPT CHECKLIST"
date: "2026-06-21T17:03:56.099Z"
source: "user-note"
knowledge_type: "user-note"
---

# MATHEMATICS 2 — FINAL EXAM FORMULA + CONCEPT CHECKLIST

# 1. BASIC 3D GEOMETRY

## Points, vectors, length

A point in 3D is

$$
P=(x,y,z).
$$

The position vector is

$$
\mathbf x=x\mathbf i+y\mathbf j+z\mathbf k.
$$

Length:

$$
|\mathbf x|=\sqrt{x^2+y^2+z^2}.
$$

Distance between $P_1=(x_1,y_1,z_1)$ and $P_2=(x_2,y_2,z_2)$:

$$
|P_2-P_1|=\sqrt{(x_2-x_1)^2+(y_2-y_1)^2+(z_2-z_1)^2}.
$$

Right-handed orientation:

$$
\mathbf i\times\mathbf j=\mathbf k,\qquad
\mathbf j\times\mathbf k=\mathbf i,\qquad
\mathbf k\times\mathbf i=\mathbf j.
$$

Switching the order changes the sign:

$$
\mathbf j\times\mathbf i=-\mathbf k.
$$

---

## Dot product

$$
\mathbf a\cdot\mathbf b=a_1b_1+a_2b_2+a_3b_3.
$$

Meaning:

$$
\mathbf a\cdot\mathbf b=0
$$

means perpendicular.

Angle formula:

$$
\cos\theta=\frac{\mathbf a\cdot\mathbf b}{|\mathbf a||\mathbf b|}.
$$

Projection of $\mathbf a$ onto $\mathbf b$:

$$
\operatorname{proj}_{\mathbf b}\mathbf a=\frac{\mathbf a\cdot\mathbf b}{|\mathbf b|^2}\mathbf b.
$$

Scalar projection:

$$
\operatorname{comp}_{\mathbf b}\mathbf a=\frac{\mathbf a\cdot\mathbf b}{|\mathbf b|}.
$$

---

## Cross product

$$
\mathbf a\times\mathbf b=
\begin{vmatrix}
\mathbf i & \mathbf j & \mathbf k \\
a_1 & a_2 & a_3 \\
b_1 & b_2 & b_3
\end{vmatrix}.
$$

Meaning:

$$
\mathbf a\times\mathbf b
$$

is perpendicular to both $\mathbf a$ and $\mathbf b$.

Area of parallelogram:

$$
A=|\mathbf a\times\mathbf b|.
$$

Area of triangle:

$$
A=\frac12|\mathbf a\times\mathbf b|.
$$

Shortcut: if you need a normal vector to a plane through three points, take two direction vectors and cross them.

---

## Lines

Line through point $\mathbf p$ in direction $\mathbf v$:

$$
\mathbf r(t)=\mathbf p+t\mathbf v.
$$

Component form:

$$
x=x_0+at,\qquad y=y_0+bt,\qquad z=z_0+ct.
$$

Symmetric form, if $a,b,c\ne0$:

$$
\frac{x-x_0}{a}=\frac{y-y_0}{b}=\frac{z-z_0}{c}.
$$

---

## Planes

Plane through point $\mathbf p$ with normal vector $\mathbf n$:

$$
\mathbf n\cdot(\mathbf x-\mathbf p)=0.
$$

If

$$
ax+by+cz=d,
$$

then a normal vector is

$$
\mathbf n=(a,b,c).
$$

Plane through three points:

$$
\mathbf n=(\mathbf p_2-\mathbf p_1)\times(\mathbf p_3-\mathbf p_1),
$$

then use

$$
\mathbf n\cdot(\mathbf x-\mathbf p_1)=0.
$$

Distance from point $P_0=(x_0,y_0,z_0)$ to plane $ax+by+cz+d=0$:

$$
\operatorname{dist}=\frac{|ax_0+by_0+cz_0+d|}{\sqrt{a^2+b^2+c^2}}.
$$

---

# 2. QUADRIC SURFACES AND SHAPE RECOGNITION

Sphere:

$$
x^2+y^2+z^2=a^2.
$$

Ellipsoid:

$$
\frac{x^2}{a^2}+\frac{y^2}{b^2}+\frac{z^2}{c^2}=1.
$$

Cylinder along $z$-axis:

$$
x^2+y^2=a^2.
$$

Elliptic paraboloid:

$$
z=x^2+y^2
$$

or more generally

$$
z=\frac{x^2}{a^2}+\frac{y^2}{b^2}.
$$

Cone:

$$
z^2=x^2+y^2.
$$

Hyperboloid of one sheet:

$$
x^2+y^2-z^2=1.
$$

Hyperboloid of two sheets:

$$
z^2-x^2-y^2=1.
$$

Saddle / hyperbolic paraboloid:

$$
z=x^2-y^2.
$$

Shortcut: if one variable is missing, the surface is usually a cylinder in the missing direction.

---

# 3. COORDINATE SYSTEMS

## Polar coordinates

$$
x=r\cos\theta,\qquad y=r\sin\theta.
$$

$$
r=\sqrt{x^2+y^2},\qquad \tan\theta=\frac yx.
$$

Area element:

$$
dA=r\,dr\,d\theta.
$$

Unit vectors:

$$
\mathbf e_r=(\cos\theta,\sin\theta),
$$

$$
\mathbf e_\theta=(-\sin\theta,\cos\theta).
$$

Use polar when you see:

$$
x^2+y^2,\qquad \text{circles, disks, annuli, sectors.}
$$

Standard disk:

$$
x^2+y^2\le a^2
\quad\Rightarrow\quad
0\le r\le a,\quad 0\le\theta\le 2\pi.
$$

Annulus:

$$
a^2\le x^2+y^2\le b^2
\quad\Rightarrow\quad
a\le r\le b.
$$

---

## Cylindrical coordinates

$$
x=r\cos\theta,\qquad y=r\sin\theta,\qquad z=z.
$$

$$
r=\sqrt{x^2+y^2}.
$$

Volume element:

$$
dV=r\,dr\,d\theta\,dz.
$$

Common conversions:

$$
x^2+y^2=r^2.
$$

$$
z=x^2+y^2
\quad\Rightarrow\quad
z=r^2.
$$

$$
x^2+y^2=a^2
\quad\Rightarrow\quad
r=a.
$$

Use cylindrical coordinates for cylinders, paraboloids, cones around the $z$-axis, circular bases, and expressions containing $x^2+y^2$.

---

## Spherical coordinates

The course/Adams convention is:

$$
x=R\sin\phi\cos\theta,
$$

$$
y=R\sin\phi\sin\theta,
$$

$$
z=R\cos\phi.
$$

Here $R$ is distance from the origin, $\phi$ is the angle from the positive $z$-axis, and $\theta$ is the usual angle in the $xy$-plane.

$$
x^2+y^2+z^2=R^2.
$$

$$
r=R\sin\phi,\qquad z=R\cos\phi.
$$

Volume element:

$$
dV=R^2\sin\phi\,dR\,d\phi\,d\theta.
$$

Sphere:

$$
R=a.
$$

Upper half-ball:

$$
0\le R\le a,\qquad 0\le\phi\le\frac\pi2,\qquad 0\le\theta\le2\pi.
$$

Cone:

$$
\phi=\text{constant}.
$$

Use spherical coordinates when you see:

$$
x^2+y^2+z^2,
$$

spheres, balls, spherical shells, cones with spherical symmetry.

---

# 4. PARAMETRIZED CURVES

A parametrized curve is

$$
\mathbf r(t)=x(t)\mathbf i+y(t)\mathbf j+z(t)\mathbf k,\qquad a\le t\le b.
$$

Velocity:

$$
\mathbf v(t)=\mathbf r'(t).
$$

Speed:

$$
v(t)=|\mathbf r'(t)|.
$$

Acceleration:

$$
\mathbf a(t)=\mathbf r''(t).
$$

Tangent vector:

$$
\mathbf r'(t_0).
$$

Tangent line at $t=t_0$:

$$
\mathbf L(s)=\mathbf r(t_0)+s\mathbf r'(t_0).
$$

Arc length:

$$
L=\int_a^b|\mathbf r'(t)|\,dt.
$$

Line element:

$$
ds=|\mathbf r'(t)|\,dt.
$$

Closed curve:

$$
\mathbf r(a)=\mathbf r(b).
$$

Important: parametrization is **not unique**. The same curve can have many parametrizations.

---

## Standard curve parametrizations

Line segment from $A$ to $B$:

$$
\mathbf r(t)=A+t(B-A),\qquad 0\le t\le1.
$$

Circle radius $a$:

$$
\mathbf r(t)=(a\cos t,a\sin t),\qquad 0\le t\le2\pi.
$$

Ellipse:

$$
\mathbf r(t)=(a\cos t,b\sin t).
$$

Helix:

$$
\mathbf r(t)=(a\cos t,a\sin t,bt).
$$

Graph $y=f(x)$:

$$
\mathbf r(t)=(t,f(t)).
$$

Graph $z=f(x,y)$ as a surface:

$$
\mathbf r(x,y)=(x,y,f(x,y)).
$$

Intersection of two surfaces:

Use one equation to express one variable in terms of a parameter, then substitute into the other.

Example strategy:

$$
x^2+y^2=1,\qquad z=x+y.
$$

Use

$$
x=\cos t,\qquad y=\sin t,\qquad z=\cos t+\sin t.
$$

---

# 5. MOTION SHORTCUTS

Speed constant if

$$
\frac d{dt}|\mathbf v(t)|^2=0.
$$

Since

$$
\frac d{dt}|\mathbf v|^2
=\frac d{dt}(\mathbf v\cdot\mathbf v)
=2\mathbf v\cdot\mathbf a,
$$

speed is constant when

$$
\mathbf v\cdot\mathbf a=0.
$$

If acceleration is perpendicular to velocity, speed is constant.

Studio-classroom useful identity:

$$
\frac d{dt}\bigl(\mathbf r(t)-t\mathbf v(t)\bigr)
=\mathbf v(t)-\mathbf v(t)-t\mathbf a(t)
=-t\mathbf a(t).
$$

To show a vector has constant length, differentiate the square of its length:

$$
\frac d{dt}|\mathbf w(t)|^2=2\mathbf w(t)\cdot\mathbf w'(t).
$$

---

# 6. FUNCTIONS OF SEVERAL VARIABLES

A scalar field is a function

$$
f:D\subseteq\mathbb R^n\to\mathbb R.
$$

A graph of $z=f(x,y)$ is a surface in $\mathbb R^3$.

A level curve of $f(x,y)$ is

$$
f(x,y)=c.
$$

A level surface of $f(x,y,z)$ is

$$
f(x,y,z)=c.
$$

Level curves cannot intersect unless the function is not well-defined as a function.

---

## Domain restrictions

For

$$
\sqrt{g(x,y)},
$$

need

$$
g(x,y)\ge0.
$$

For

$$
\ln(g(x,y)),
$$

need

$$
g(x,y)>0.
$$

For

$$
\frac1{g(x,y)},
$$

need

$$
g(x,y)\ne0.
$$

For

$$
\arcsin(g(x,y)),
$$

need

$$
-1\le g(x,y)\le1.
$$

For combinations, impose all restrictions simultaneously.

Maximum domain = all points where the formula makes sense.

---

## Open, closed, boundary, isolated

Interior point: a small ball around the point lies completely inside the set.

Boundary point: every small ball around the point contains points inside and outside the set.

Open set: contains none of its boundary points.

Closed set: contains all of its boundary points.

A set may be neither open nor closed.

Isolated point: there is a small ball around it containing no other points of the set.

Not isolated: every small ball around it contains another point of the set.

---

# 7. LIMITS AND CONTINUITY

Limit:

$$
\lim_{\mathbf x\to\mathbf a}f(\mathbf x)=L.
$$

Continuity at $\mathbf a$:

$$
\lim_{\mathbf x\to\mathbf a}f(\mathbf x)=f(\mathbf a).
$$

To show a limit **does not exist**, use different paths:

$$
y=0,\qquad x=0,\qquad y=x,\qquad y=mx,\qquad y=x^2.
$$

If two paths give different limits, the full limit does not exist.

To show a limit **exists**, paths are not enough. Use estimates, often with polar:

$$
x=r\cos\theta,\qquad y=r\sin\theta.
$$

Then show the expression tends to the same value as $r\to0$, independently of $\theta$.

Useful bounds:

$$
|\sin\theta|\le1,\qquad |\cos\theta|\le1.
$$

$$
|xy|\le\frac{x^2+y^2}{2}.
$$

$$
r=\sqrt{x^2+y^2}.
$$

If

$$
|f(x,y)|\le C r^p,\qquad p>0,
$$

then

$$
f(x,y)\to0.
$$

---

# 8. PARTIAL DERIVATIVES

For $f(x,y)$:

$$
f_x=\frac{\partial f}{\partial x},\qquad
f_y=\frac{\partial f}{\partial y}.
$$

Hold the other variable constant.

Definition:

$$
f_x(a,b)=\lim_{h\to0}\frac{f(a+h,b)-f(a,b)}{h}.
$$

$$
f_y(a,b)=\lim_{h\to0}\frac{f(a,b+h)-f(a,b)}{h}.
$$

Second derivatives:

$$
f_{xx},\qquad f_{yy},\qquad f_{xy},\qquad f_{yx}.
$$

If second partial derivatives are continuous near the point:

$$
f_{xy}=f_{yx}.
$$

Derivative matrix for vector-valued function

$$
\mathbf f=(f_1,\ldots,f_m)
$$

is

$$
D\mathbf f=
\begin{pmatrix}
\frac{\partial f_1}{\partial x_1} & \cdots & \frac{\partial f_1}{\partial x_n} \\
\vdots & \ddots & \vdots \\
\frac{\partial f_m}{\partial x_1} & \cdots & \frac{\partial f_m}{\partial x_n}
\end{pmatrix}.
$$

For a scalar function $f:\mathbb R^n\to\mathbb R$, the derivative matrix is the row of partial derivatives, and the gradient is the corresponding vector.

---

# 9. TANGENT PLANES AND NORMAL LINES

## Graph surface

For

$$
z=f(x,y)
$$

at

$$
(a,b,f(a,b)),
$$

the tangent plane is

$$
z=f(a,b)+f_x(a,b)(x-a)+f_y(a,b)(y-b).
$$

Normal vector to this graph:

$$
(f_x(a,b),f_y(a,b),-1)
$$

or

$$
(-f_x(a,b),-f_y(a,b),1).
$$

---

## Implicit surface

For

$$
F(x,y,z)=0,
$$

the normal vector at $(a,b,c)$ is

$$
\nabla F(a,b,c).
$$

Tangent plane:

$$
\nabla F(a,b,c)\cdot(x-a,y-b,z-c)=0.
$$

Normal line:

$$
\mathbf r(t)=(a,b,c)+t\nabla F(a,b,c).
$$

---

## Tangent line to intersection of two surfaces

If the curve is the intersection of

$$
F(x,y,z)=0,\qquad G(x,y,z)=0,
$$

then the tangent direction is perpendicular to both gradients:

$$
\mathbf v=\nabla F(a,b,c)\times\nabla G(a,b,c).
$$

Tangent line:

$$
\mathbf r(t)=(a,b,c)+t\mathbf v.
$$

---

# 10. CHAIN RULE

If

$$
z=f(x(t),y(t)),
$$

then

$$
\frac{dz}{dt}=f_x\frac{dx}{dt}+f_y\frac{dy}{dt}.
$$

Vector form:

$$
\frac d{dt}f(\mathbf r(t))=\nabla f(\mathbf r(t))\cdot\mathbf r'(t).
$$

If

$$
z=f(x(u,v),y(u,v)),
$$

then

$$
\frac{\partial z}{\partial u}=f_x\frac{\partial x}{\partial u}+f_y\frac{\partial y}{\partial u},
$$

$$
\frac{\partial z}{\partial v}=f_x\frac{\partial x}{\partial v}+f_y\frac{\partial y}{\partial v}.
$$

General matrix form:

$$
D(f\circ g)(\mathbf x)=Df(g(\mathbf x))Dg(\mathbf x).
$$

Recognition shortcut:

Outer derivative evaluated at inner function, multiplied by derivative of inner function.

---

# 11. LINEAR APPROXIMATION AND DIFFERENTIALS

For $f(x,y)$ near $(a,b)$:

$$
L(x,y)=f(a,b)+f_x(a,b)(x-a)+f_y(a,b)(y-b).
$$

This is the tangent-plane approximation.

With

$$
dx=x-a,\qquad dy=y-b,
$$

the differential is

$$
df=f_x\,dx+f_y\,dy.
$$

Approximation:

$$
\Delta f\approx df.
$$

For $f(x,y,z)$:

$$
df=f_x\,dx+f_y\,dy+f_z\,dz.
$$

---

# 12. GRADIENT AND DIRECTIONAL DERIVATIVES

Gradient in 2D:

$$
\nabla f=(f_x,f_y).
$$

Gradient in 3D:

$$
\nabla f=(f_x,f_y,f_z).
$$

Directional derivative in direction of a **unit vector** $\mathbf u$:

$$
D_{\mathbf u}f(\mathbf a)=\nabla f(\mathbf a)\cdot\mathbf u.
$$

If the given direction is not unit length, first normalize:

$$
\mathbf u=\frac{\mathbf v}{|\mathbf v|}.
$$

Fastest increase direction:

$$
\frac{\nabla f}{|\nabla f|}.
$$

Maximum rate of increase:

$$
|\nabla f|.
$$

Fastest decrease direction:

$$
-\frac{\nabla f}{|\nabla f|}.
$$

Maximum rate of decrease:

$$
-|\nabla f|.
$$

Gradient is perpendicular to level curves/surfaces:

$$
\nabla f\perp\{f=c\}.
$$

If a curve crosses level curves perpendicularly, its tangent direction is parallel to the gradient.

The lecturer explicitly warned that direction vectors in directional derivatives must be normalized.

---

# 13. TAYLOR FORMULAS

## One-variable formulas around $0$

$$
e^x=1+x+\frac{x^2}{2}+\frac{x^3}{6}+\cdots
$$

$$
\sin x=x-\frac{x^3}{6}+\frac{x^5}{120}+\cdots
$$

$$
\cos x=1-\frac{x^2}{2}+\frac{x^4}{24}+\cdots
$$

$$
\ln(1+x)=x-\frac{x^2}{2}+\frac{x^3}{3}-\cdots
$$

$$
\frac1{1-x}=1+x+x^2+x^3+\cdots
$$

$$
\frac1{1+x}=1-x+x^2-x^3+\cdots
$$

$$
(1+x)^\alpha=1+\alpha x+\frac{\alpha(\alpha-1)}2x^2+\cdots
$$

$$
\sqrt{1+x}=1+\frac x2-\frac{x^2}{8}+\cdots
$$

---

## One-variable Taylor around $a$

Let

$$
h=x-a.
$$

Then

$$
f(a+h)=f(a)+f'(a)h+\frac12f''(a)h^2+\cdots.
$$

Degree 2:

$$
P_2(x)=f(a)+f'(a)(x-a)+\frac12f''(a)(x-a)^2.
$$

---

## Two-variable Taylor polynomial of degree 2

Let

$$
h=x-a,\qquad k=y-b.
$$

Then

$$
f(a+h,b+k)
\approx
f(a,b)
+
f_x(a,b)h
+
f_y(a,b)k
+
\frac12
\left[
f_{xx}(a,b)h^2
+
2f_{xy}(a,b)hk
+
f_{yy}(a,b)k^2
\right].
$$

Matrix form:

$$
f(\mathbf a+\mathbf h)
\approx
f(\mathbf a)
+
\nabla f(\mathbf a)\cdot\mathbf h
+
\frac12\mathbf h^T H_f(\mathbf a)\mathbf h.
$$

Hessian matrix:

$$
H_f=
\begin{pmatrix}
f_{xx} & f_{xy} \\
f_{yx} & f_{yy}
\end{pmatrix}.
$$

The study guide specifically restricts Taylor exercises to degree 2 in the relevant week.

---

# 14. CRITICAL POINTS AND HESSIAN CLASSIFICATION

A critical point of $f(x,y)$ satisfies

$$
\nabla f(a,b)=0
$$

or one of the partial derivatives does not exist.

Second derivative test:

$$
D=f_{xx}(a,b)f_{yy}(a,b)-[f_{xy}(a,b)]^2.
$$

If

$$
D>0,\qquad f_{xx}(a,b)>0,
$$

then local minimum.

If

$$
D>0,\qquad f_{xx}(a,b)<0,
$$

then local maximum.

If

$$
D<0,
$$

then saddle point.

If

$$
D=0,
$$

the test is inconclusive.

Recognition: a saddle is not a minimum or maximum, even if partial derivatives vanish.

---

# 15. DOUBLE INTEGRALS

A double integral adds values over a plane region:

$$
\iint_D f(x,y)\,dA.
$$

Area:

$$
A(D)=\iint_D1\,dA.
$$

Mass with density $\rho(x,y)$:

$$
m=\iint_D\rho(x,y)\,dA.
$$

Average value:

$$
f_{\text{avg}}=\frac1{A(D)}\iint_D f\,dA.
$$

Linearity:

$$
\iint_D(af+bg)\,dA=a\iint_Df\,dA+b\iint_Dg\,dA.
$$

Additivity:

$$
\iint_D f\,dA=\iint_{D_1}f\,dA+\iint_{D_2}f\,dA
$$

if $D=D_1\cup D_2$ without overlap except boundaries.

---

## $x$-simple region

$$
D=\{(x,y):a\le x\le b,\ c(x)\le y\le d(x)\}.
$$

Then

$$
\iint_D f(x,y)\,dA
=
\int_a^b\int_{c(x)}^{d(x)}
f(x,y)\,dy\,dx.
$$

---

## $y$-simple region

$$
D=\{(x,y):c\le y\le d,\ a(y)\le x\le b(y)\}.
$$

Then

$$
\iint_D f(x,y)\,dA
=
\int_c^d\int_{a(y)}^{b(y)}
f(x,y)\,dx\,dy.
$$

---

## Changing integration order

Steps:

1. Read the old bounds as inequalities.
2. Sketch the region.
3. Rewrite the same region with the other variable outermost.
4. Replace the integral.

Example:

$$
\int_0^1\int_{\sqrt y}^1 f(x,y)\,dx\,dy.
$$

This means

$$
0\le y\le1,\qquad \sqrt y\le x\le1.
$$

Since

$$
x\ge\sqrt y
\quad\Longleftrightarrow\quad
y\le x^2,
$$

the same region is

$$
0\le x\le1,\qquad 0\le y\le x^2.
$$

So

$$
\int_0^1\int_{\sqrt y}^1 f(x,y)\,dx\,dy
=
\int_0^1\int_0^{x^2} f(x,y)\,dy\,dx.
$$

Exam trigger: if the inner integral has no easy primitive, change order. The lecturer explicitly used this as an exam-style warning.

---

# 16. POLAR DOUBLE INTEGRALS

Use

$$
x=r\cos\theta,\qquad y=r\sin\theta.
$$

Replace

$$
dA
$$

by

$$
r\,dr\,d\theta.
$$

Thus

$$
\iint_D f(x,y)\,dA
=
\iint_{D'} f(r\cos\theta,r\sin\theta)\,r\,dr\,d\theta.
$$

Common regions:

Disk:

$$
0\le r\le a,\quad 0\le\theta\le2\pi.
$$

Upper half-disk:

$$
0\le r\le a,\quad 0\le\theta\le\pi.
$$

First quadrant disk:

$$
0\le r\le a,\quad 0\le\theta\le\frac\pi2.
$$

Annulus:

$$
a\le r\le b.
$$

Sector:

$$
\alpha\le\theta\le\beta.
$$

---

# 17. CHANGE OF VARIABLES AND JACOBIANS

## 2D change of variables

If

$$
x=x(u,v),\qquad y=y(u,v),
$$

then

$$
dx\,dy=
\left|
\frac{\partial(x,y)}{\partial(u,v)}
\right|
du\,dv.
$$

Jacobian:

$$
\frac{\partial(x,y)}{\partial(u,v)}
=
\begin{vmatrix}
x_u & x_v \\
y_u & y_v
\end{vmatrix}
=x_u y_v-x_v y_u.
$$

Always use absolute value:

$$
|J|.
$$

The lecturer explains the Jacobian as the area correction between a small rectangle in new coordinates and the deformed parallelogram in old coordinates.

---

## Polar Jacobian

$$
x=r\cos\theta,\qquad y=r\sin\theta.
$$

$$
J=\frac{\partial(x,y)}{\partial(r,\theta)}=r.
$$

So

$$
dx\,dy=r\,dr\,d\theta.
$$

---

## Ellipse shortcut

For

$$
\frac{x^2}{a^2}+\frac{y^2}{b^2}\le1,
$$

use

$$
x=ar\cos\theta,\qquad y=br\sin\theta.
$$

Then

$$
|J|=ab\,r.
$$

Bounds:

$$
0\le r\le1,\qquad 0\le\theta\le2\pi.
$$

Area:

$$
A=\pi ab.
$$

---

# 18. TRIPLE INTEGRALS

A triple integral adds values over a solid:

$$
\iiint_D f(x,y,z)\,dV.
$$

Volume:

$$
V(D)=\iiint_D1\,dV.
$$

Mass with density $\rho$:

$$
m=\iiint_D\rho(x,y,z)\,dV.
$$

Average value:

$$
f_{\text{avg}}=\frac1{V(D)}\iiint_Df\,dV.
$$

If

$$
D=\{(x,y,z):a\le x\le b,\ c(x)\le y\le d(x),\ e(x,y)\le z\le g(x,y)\},
$$

then

$$
\iiint_D f\,dV
=
\int_a^b
\int_{c(x)}^{d(x)}
\int_{e(x,y)}^{g(x,y)}
f(x,y,z)\,dz\,dy\,dx.
$$

The lecture introduces triple integrals as the 3D analogue of double integrals: volume comes from summing small volume elements, and mass comes from multiplying density by volume elements.

---

## 3D change of variables

If

$$
x=x(u,v,w),\qquad y=y(u,v,w),\qquad z=z(u,v,w),
$$

then

$$
dx\,dy\,dz
=
\left|
\frac{\partial(x,y,z)}{\partial(u,v,w)}
\right|
du\,dv\,dw.
$$

Jacobian:

$$
\frac{\partial(x,y,z)}{\partial(u,v,w)}
=
\begin{vmatrix}
x_u & x_v & x_w \\
y_u & y_v & y_w \\
z_u & z_v & z_w
\end{vmatrix}.
$$

---

## Cylindrical triple integral

$$
dV=r\,dr\,d\theta\,dz.
$$

$$
\iiint_D f(x,y,z)\,dV
=
\iiint_{D'} f(r\cos\theta,r\sin\theta,z)\,r\,dr\,d\theta\,dz.
$$

---

## Spherical triple integral

$$
dV=R^2\sin\phi\,dR\,d\phi\,d\theta.
$$

$$
\iiint_D f(x,y,z)\,dV
=
\iiint_{D'}
f(R\sin\phi\cos\theta,R\sin\phi\sin\theta,R\cos\phi)
R^2\sin\phi\,dR\,d\phi\,d\theta.
$$

---

# 19. SURFACE AREA OF A GRAPH

For a graph

$$
z=g(x,y)
$$

over a domain $D$ in the $xy$-plane,

$$
dS=\sqrt{1+g_x^2+g_y^2}\,dA.
$$

Surface area:

$$
A(S)=\iint_D\sqrt{1+g_x^2+g_y^2}\,dA.
$$

Scalar surface integral over a graph:

$$
\iint_S f(x,y,z)\,dS
=
\iint_D
f(x,y,g(x,y))
\sqrt{1+g_x^2+g_y^2}\,dA.
$$

Special case:

If

$$
z=ax+by+c,
$$

then

$$
dS=\sqrt{1+a^2+b^2}\,dA.
$$

---

# 20. PARAMETRIC SURFACES AND SCALAR SURFACE INTEGRALS

A parametrized surface is

$$
\mathbf r(u,v)=x(u,v)\mathbf i+y(u,v)\mathbf j+z(u,v)\mathbf k,
\qquad (u,v)\in D.
$$

Tangent vectors:

$$
\mathbf r_u=\frac{\partial\mathbf r}{\partial u},
\qquad
\mathbf r_v=\frac{\partial\mathbf r}{\partial v}.
$$

Normal vector candidate:

$$
\mathbf r_u\times\mathbf r_v.
$$

Surface element:

$$
dS=|\mathbf r_u\times\mathbf r_v|\,du\,dv.
$$

Scalar surface integral:

$$
\iint_S f\,dS
=
\iint_D
f(\mathbf r(u,v))
|\mathbf r_u\times\mathbf r_v|
\,du\,dv.
$$

Important: for scalar surface integrals, use the **length**

$$
|\mathbf r_u\times\mathbf r_v|.
$$

Do not use

$$
\mathbf F\cdot\mathbf n.
$$

That is flux and is excluded.

---

## Standard $dS$ shortcuts

Cylinder $r=a$:

$$
\mathbf r(\theta,z)=(a\cos\theta,a\sin\theta,z),
$$

$$
dS=a\,d\theta\,dz.
$$

Sphere $R=a$:

$$
\mathbf r(\phi,\theta)=
(a\sin\phi\cos\theta,a\sin\phi\sin\theta,a\cos\phi),
$$

$$
dS=a^2\sin\phi\,d\phi\,d\theta.
$$

Plane graph $z=ax+by+c$:

$$
dS=\sqrt{1+a^2+b^2}\,dx\,dy.
$$

Composite surface:

$$
\iint_S f\,dS
=
\iint_{S_1}f\,dS+\iint_{S_2}f\,dS+\cdots.
$$

---

# 21. VECTOR FIELDS AND FIELD LINES

A scalar field gives one number at each point:

$$
f:D\to\mathbb R.
$$

Examples: temperature, height, density, potential.

A vector field gives one vector at each point:

$$
\mathbf F:D\to\mathbb R^n.
$$

In 2D:

$$
\mathbf F(x,y)=P(x,y)\mathbf i+Q(x,y)\mathbf j.
$$

In 3D:

$$
\mathbf F(x,y,z)=P\mathbf i+Q\mathbf j+R\mathbf k.
$$

Field lines / streamlines satisfy

$$
\mathbf r'(t)=\mathbf F(\mathbf r(t)).
$$

In 2D, if

$$
\mathbf F=(P,Q),
$$

then field lines can be found from

$$
\frac{dy}{dx}=\frac{Q}{P}
$$

or

$$
\frac{dx}{P}=\frac{dy}{Q}.
$$

Then separate variables if possible.

Example pattern:

$$
\frac{dx}{P(x,y)}=\frac{dy}{Q(x,y)}.
$$

Solve and add the condition that the curve passes through $(x_0,y_0)$.

The lecturer used exactly this streamline method in the final-exam discussion.

---

# 22. CONSERVATIVE FIELDS

A vector field is conservative if there exists a scalar potential $\phi$ such that

$$
\mathbf F=\nabla\phi.
$$

Then

$$
\phi
$$

is called a potential function.

In components:

$$
\mathbf F=(P,Q)
$$

is conservative if

$$
P=\phi_x,\qquad Q=\phi_y.
$$

In 3D:

$$
\mathbf F=(P,Q,R)
$$

is conservative if

$$
P=\phi_x,\qquad Q=\phi_y,\qquad R=\phi_z.
$$

---

## Conservative field test

In 2D, on a simply connected domain:

$$
\mathbf F=(P,Q)
$$

is conservative if

$$
P_y=Q_x.
$$

In 3D, on a simply connected domain:

$$
\mathbf F=(P,Q,R)
$$

is conservative if

$$
P_y=Q_x,
$$

$$
P_z=R_x,
$$

$$
Q_z=R_y.
$$

Equivalent statement:

$$
D\mathbf F
$$

is symmetric.

The lecture slide states this exactly: on a simply connected domain, a differentiable field is conservative if and only if the derivative matrix is symmetric.

---

## Simply connected warning

Simply connected means roughly: connected and no holes.

A domain with a hole can break the conservative-field test.

Standard trap:

$$
\mathbf F(x,y)=
\left(
\frac{-y}{x^2+y^2},
\frac{x}{x^2+y^2}
\right)
$$

on

$$
\mathbb R^2\setminus\{(0,0)\}.
$$

The partial derivative symmetry may hold away from the origin, but the field is not conservative on a domain containing loops around the missing origin.

Shortcut: derivative symmetry + hole-free domain gives conservative. Derivative symmetry + hole may not be enough.

---

# 23. FINDING A POTENTIAL FUNCTION

If

$$
\mathbf F=(P,Q)=\nabla\phi,
$$

then

$$
\phi_x=P,\qquad \phi_y=Q.
$$

Mechanical method in 2D:

1. Integrate $P$ with respect to $x$:

$$
\phi(x,y)=\int P(x,y)\,dx+C(y).
$$

2. Differentiate this expression with respect to $y$.

3. Set it equal to $Q$.

4. Solve for $C'(y)$, then integrate to get $C(y)$.

---

In 3D:

$$
\mathbf F=(P,Q,R)=\nabla\phi.
$$

Then

$$
\phi_x=P,\qquad \phi_y=Q,\qquad \phi_z=R.
$$

Mechanical method in 3D:

1. Integrate $P$ with respect to $x$:

$$
\phi=\int P\,dx+C(y,z).
$$

2. Differentiate with respect to $y$, compare with $Q$, solve for $C_y$.

3. Integrate to reduce $C(y,z)$.

4. Differentiate with respect to $z$, compare with $R$, solve remaining unknown function.

If the method becomes inconsistent, the field is not conservative.

The lecturer demonstrates this exact procedure: integrate one component, add an unknown function of the remaining variables, then compare with the next component.

---

# 24. EQUIPOTENTIAL CURVES AND SURFACES

If

$$
\mathbf F=\nabla\phi,
$$

then $\phi$ is the potential.

An equipotential curve or surface is a level set of the potential:

$$
\phi(x,y)=c
$$

in 2D, or

$$
\phi(x,y,z)=c
$$

in 3D.

Meaning: all points on the same equipotential have the same potential value.

Because

$$
\nabla\phi
$$

is perpendicular to level sets, a conservative field

$$
\mathbf F=\nabla\phi
$$

is perpendicular to equipotential curves/surfaces.

So:

$$
\mathbf F \perp \{\phi=c\}.
$$

If the convention is

$$
\mathbf F=-\nabla U,
$$

then field lines are still perpendicular to equipotentials, but point in the direction of decreasing $U$.

The lecture slide explicitly defines equipotential surfaces as level sets of the potential and asks to show that field lines and equipotential surfaces are perpendicular.

---

# 25. SOURCES, SINKS, DIPOLES

A source is a point where field lines flow outward.

A sink is a point where field lines flow inward.

A dipole is a source-sink pair or positive-negative pair; field lines leave one point and enter the other.

For point-source type fields in 3D, a common radial pattern is

$$
\mathbf F(\mathbf r)=C\frac{\mathbf r-\mathbf r_0}{|\mathbf r-\mathbf r_0|^3}.
$$

Potential-type pattern:

$$
\phi(\mathbf r)=\frac{C}{|\mathbf r-\mathbf r_0|}.
$$

Then

$$
\nabla\left(\frac1{|\mathbf r-\mathbf r_0|}\right)
=-\frac{\mathbf r-\mathbf r_0}{|\mathbf r-\mathbf r_0|^3}.
$$

So be careful with signs:

$$
\nabla\left(\frac{C}{|\mathbf r-\mathbf r_0|}\right)
=-C\frac{\mathbf r-\mathbf r_0}{|\mathbf r-\mathbf r_0|^3}.
$$

Course relevance: recognize the shape, the singularity at the source point, and the relation to conservative fields/equipotentials. Do not confuse this with divergence/curl interpretation from Adams 17.1.

Adams 16.2 includes sources, sinks, and dipoles directly after the conservative-field discussion.

---

# 26. LINE INTEGRALS OF SCALAR FIELDS

Scalar line integral:

$$
\int_C f\,ds.
$$

If

$$
\mathbf r(t),\qquad a\le t\le b,
$$

then

$$
\int_C f\,ds
=
\int_a^b f(\mathbf r(t))|\mathbf r'(t)|\,dt.
$$

Use for mass of a wire:

$$
m=\int_C \rho\,ds.
$$

If

$$
f=1,
$$

then

$$
\int_C1\,ds
$$

is the length of the curve.

Orientation does **not** matter for scalar line integrals.

---

# 27. LINE INTEGRALS OF VECTOR FIELDS

Vector line integral / work integral:

$$
\int_C\mathbf F\cdot d\mathbf r.
$$

If

$$
\mathbf r(t),\qquad a\le t\le b,
$$

then

$$
\int_C\mathbf F\cdot d\mathbf r
=
\int_a^b
\mathbf F(\mathbf r(t))\cdot\mathbf r'(t)\,dt.
$$

Equivalent notation:

$$
\int_C P\,dx+Q\,dy+R\,dz.
$$

If

$$
\mathbf r(t)=(x(t),y(t),z(t)),
$$

then

$$
dx=x'(t)\,dt,\qquad dy=y'(t)\,dt,\qquad dz=z'(t)\,dt.
$$

Therefore:

$$
\int_C P\,dx+Q\,dy+R\,dz
=
\int_a^b
\left[
P(\mathbf r(t))x'(t)
+
Q(\mathbf r(t))y'(t)
+
R(\mathbf r(t))z'(t)
\right]dt.
$$

Orientation matters. Reversing the curve changes the sign:

$$
\int_{-C}\mathbf F\cdot d\mathbf r
=-\int_C\mathbf F\cdot d\mathbf r.
$$

Closed curve notation:

$$
\oint_C\mathbf F\cdot d\mathbf r.
$$

If $C$ is closed, the vector line integral is called circulation.

---

# 28. FUNDAMENTAL THEOREM FOR CONSERVATIVE FIELDS

If

$$
\mathbf F=\nabla\phi,
$$

then

$$
\int_C\mathbf F\cdot d\mathbf r
=
\phi(\mathbf r(b))-\phi(\mathbf r(a)).
$$

Meaning: only endpoint values matter.

If $C$ is closed:

$$
\oint_C\mathbf F\cdot d\mathbf r=0.
$$

Path independence:

If two curves have the same start and end point, then

$$
\int_{C_1}\mathbf F\cdot d\mathbf r
=
\int_{C_2}\mathbf F\cdot d\mathbf r.
$$

This only works for conservative fields.

The lecturer emphasizes that for a conservative field over a closed curve, you should not compute the full integral directly; use endpoint potential values, giving zero for closed curves.

---

# 29. $ds$, $dA$, $dV$, $dS$: DO NOT MIX THEM

Curve element:

$$
ds=|\mathbf r'(t)|\,dt.
$$

Plane area element in Cartesian:

$$
dA=dx\,dy.
$$

Polar area element:

$$
dA=r\,dr\,d\theta.
$$

Volume element in Cartesian:

$$
dV=dx\,dy\,dz.
$$

Cylindrical volume element:

$$
dV=r\,dr\,d\theta\,dz.
$$

Spherical volume element:

$$
dV=R^2\sin\phi\,dR\,d\phi\,d\theta.
$$

Graph surface element:

$$
dS=\sqrt{1+g_x^2+g_y^2}\,dA.
$$

Parametric surface element:

$$
dS=|\mathbf r_u\times\mathbf r_v|\,du\,dv.
$$

Cylinder surface $r=a$:

$$
dS=a\,d\theta\,dz.
$$

Sphere surface $R=a$:

$$
dS=a^2\sin\phi\,d\phi\,d\theta.
$$

Most common error: using $dA$ when the problem needs $dS$, or forgetting the extra $r$ / $R^2\sin\phi$.

---

# 30. TRIG AND INTEGRATION SHORTCUTS

## Powers of sine and cosine

For

$$
\int \sin^m x\cos^n x\,dx,
$$

if one power is odd, save one factor and substitute.

Example:

$$
\int \sin^3x\cos^4x\,dx
=
\int (1-\cos^2x)\cos^4x\sin x\,dx,
$$

use

$$
u=\cos x.
$$

If both powers are even, use:

$$
\sin^2x=\frac{1-\cos2x}{2},
$$

$$
\cos^2x=\frac{1+\cos2x}{2}.
$$

The lecturer explicitly says this is needed for cylindrical/spherical coordinate integrals and that if one power is odd use substitution, if both are even use double-angle formulas.

---

## Common primitives

$$
\int x^n\,dx=\frac{x^{n+1}}{n+1}+C,\qquad n\ne-1.
$$

$$
\int \frac1x\,dx=\ln|x|+C.
$$

$$
\int e^x\,dx=e^x+C.
$$

$$
\int \sin x\,dx=-\cos x+C.
$$

$$
\int \cos x\,dx=\sin x+C.
$$

$$
\int \sec^2x\,dx=\tan x+C.
$$

$$
\int \frac1{1+x^2}\,dx=\arctan x+C.
$$

---

## Substitution warning

If using substitution in a definite integral, change the bounds.

If

$$
u=g(t),
$$

then bounds become

$$
u(a)=g(a),\qquad u(b)=g(b).
$$

The lecturer says exam integrals should be solvable by substitution or by a known primitive, not by memorizing exotic integrals.

---

# 31. SYMMETRY SHORTCUTS

If $D$ is symmetric in $x$ and $f$ is odd in $x$:

$$
f(-x,y)=-f(x,y),
$$

then

$$
\iint_D f\,dA=0.
$$

If $D$ is symmetric in $y$ and $f$ is odd in $y$, the integral is also zero.

In 3D, if the solid is symmetric in $x$ and

$$
f(-x,y,z)=-f(x,y,z),
$$

then

$$
\iiint_D f\,dV=0.
$$

Radial symmetry:

If the region is a disk and the integrand depends only on

$$
x^2+y^2,
$$

use polar.

If the region is a ball and the integrand depends only on

$$
x^2+y^2+z^2,
$$

use spherical.

---

# 32. COMMON COMPLETING-SQUARE PATTERNS

$$
x^2+2ax=(x+a)^2-a^2.
$$

$$
x^2-2ax=(x-a)^2-a^2.
$$

Example:

$$
x^2+y^2+2y\le3
$$

becomes

$$
x^2+(y+1)^2\le4.
$$

So the region is a disk centered at

$$
(0,-1)
$$

with radius

$$
2.
$$

Use this when finding projection domains for triple integrals.

---

# 33. RECOGNITION TABLE

| If you see this | Do this |
| --- | --- |
| $\sqrt{g}$ | Require $g\ge0$ |
| $\ln(g)$ | Require $g>0$ |
| denominator $g$ | Require $g\ne0$ |
| $x^2+y^2$ | Try polar/cylindrical |
| $x^2+y^2+z^2$ | Try spherical |
| $z=x^2+y^2$ | Write $z=r^2$ |
| $x^2+y^2=a^2$ | Cylinder/circle $r=a$ |
| sphere/ball | Use spherical |
| cylinder/paraboloid | Use cylindrical |
| hard inner primitive | Change integration order |
| direction vector for $D_{\mathbf u}f$ | Normalize first |
| fastest increase | Use $\nabla f$ |
| fastest decrease | Use $-\nabla f$ |
| level curve/surface | Gradient perpendicular |
| tangent plane to $F=0$ | Use $\nabla F$ as normal |
| tangent line to intersection | Use $\nabla F\times\nabla G$ |
| conservative field | Find potential |
| closed curve + conservative field | Integral $=0$ |
| scalar line integral | Use $ds=|\mathbf r'(t)|\,dt$ |
| vector line integral | Use $\mathbf F(\mathbf r(t))\cdot\mathbf r'(t)$ |
| graph surface | Use $\sqrt{1+g_x^2+g_y^2}$ |
| parametric surface | Use $|\mathbf r_u\times\mathbf r_v|$ |
| equipotential | Level set $\phi=c$ |
| field lines vs equipotentials | Perpendicular |
| source | Field lines outward |
| sink | Field lines inward |
| dipole | Source-sink pair |
| one trig power odd | Substitute |
| both trig powers even | Double-angle formulas |
| symmetric domain + odd integrand | Integral $=0$ |
| result is area/volume/mass | Must be nonnegative |

---

# 34. MOST COMMON MISTAKES

Forgetting to normalize direction vectors:

$$
\mathbf u=\frac{\mathbf v}{|\mathbf v|}.
$$

Forgetting the Jacobian:

$$
dA\ne dr\,d\theta,
\qquad
dA=r\,dr\,d\theta.
$$

Forgetting spherical factor:

$$
dV\ne dR\,d\phi\,d\theta,
\qquad
dV=R^2\sin\phi\,dR\,d\phi\,d\theta.
$$

Using $dA$ instead of $dS$ on a surface.

Using flux formulas when the question asks scalar surface integral.

Not drawing the region before changing integration order.

Thinking that checking two paths proves a limit exists. It only disproves if values differ.

Assuming $P_y=Q_x$ always means conservative. You also need a suitable domain, usually simply connected.

Forgetting constants of integration depend on the other variables:

$$
\phi=\int P\,dx+C(y,z),
$$

not just $+C$.

Forgetting orientation in vector line integrals.

Confusing field lines with equipotential curves. Field lines follow $\mathbf F$; equipotentials are $\phi=c$. They are perpendicular for conservative fields.

Forgetting that $r\ge0$ and $R\ge0$.

Using $\tan\theta=y/x$ without checking the quadrant.

Accepting a negative volume or negative mass when the density is nonnegative.

---

# 35. FINAL EXAM PRIORITY ORDER

1. Set up domains correctly.
2. Draw regions before changing order.
3. Choose the right coordinate system.
4. Include the correct differential element: $ds,dA,dV,dS$.
5. Normalize direction vectors.
6. Use gradients for tangent planes, normals, level sets, fastest increase.
7. Use potential functions whenever a field is conservative.
8. Keep scalar surface integrals separate from flux.
9. Know equipotentials: $\phi=c$, perpendicular to field lines.
10. Check signs, units, and whether the result must be positive.
