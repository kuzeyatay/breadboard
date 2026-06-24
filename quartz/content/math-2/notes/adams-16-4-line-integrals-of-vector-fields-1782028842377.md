---
title: "16.4: Line Integrals of Vector Fields"
date: "2026-06-21T08:00:42.377Z"
source: "user-note"
knowledge_type: "user-note"
---

# Adams 16.4: Line Integrals of Vector Fields

In the previous section, a line integral was used to add a scalar quantity along a curve. If $f(x,y,z)$ is a scalar field, then $f$ assigns a number to each point, and the line integral

$$
\int_C f\,ds
$$

adds those numerical values along small pieces of the curve $C$. This is appropriate for quantities such as density, temperature, or cost per unit length, because those quantities do not have a direction. A vector field is different. A vector field assigns a vector to each point, and a vector has both magnitude and direction. Therefore, when a curve passes through a vector field, it is not enough to ask “how large is the field along the curve?” We must ask how much of the field points in the direction in which the curve is being traversed.

The immediate problem solved in this section is the problem of computing the accumulated effect of a directed field along a directed path. The standard physical interpretation is work. If a force pushes an object along a path, then only the component of the force in the direction of motion contributes to work. A force perpendicular to the motion may be large, but it does no work along that motion because it does not help or oppose the displacement. The line integral of a vector field is the operation that adds these tangential components along the whole curve.

![pasted 1782029277051](/math-2/assets/pasted-1782029277051.png)

Let $C$ be a smooth oriented curve. A curve is called smooth when it has a differentiable parametrization whose velocity vector is not zero on the interval being considered. The word oriented means that a direction of travel along the curve has been chosen. A curve from $A$ to $B$ and the same geometric curve from $B$ to $A$ have opposite orientations.

Suppose $C$ is parametrized by

$$
\mathbf r(t)=x(t)\mathbf i+y(t)\mathbf j+z(t)\mathbf k,\qquad a\leq t\leq b.
$$

Here $t$ is the parameter, $\mathbf r(t)$ is the position vector of the point on the curve, and $x(t)$, $y(t)$, and $z(t)$ are the coordinate functions. The derivative

$$
\mathbf r'(t)=\frac{d\mathbf r}{dt}
$$

is the velocity vector of the parametrized curve. It points tangent to the curve in the direction of increasing $t$. Its length

$$
|\mathbf r'(t)|
$$

is the speed of the parametrization. The corresponding arc length element is

$$
ds=|\mathbf r'(t)|\,dt.
$$

If $\mathbf r'(t)\neq \mathbf 0$, the unit tangent vector is

$$
\mathbf T(t)=\frac{\mathbf r'(t)}{|\mathbf r'(t)|}.
$$

This vector has length $1$ and points in the chosen direction of travel along the curve.

Now let

$$
\mathbf F(x,y,z)=F_1(x,y,z)\mathbf i+F_2(x,y,z)\mathbf j+F_3(x,y,z)\mathbf k
$$

be a vector field. This means that at each point $(x,y,z)$ in its domain, $\mathbf F$ gives a vector with components $F_1$, $F_2$, and $F_3$. If the curve passes through the field, then at the point $\mathbf r(t)$ the field is

$$
\mathbf F(\mathbf r(t)).
$$

The component of $\mathbf F(\mathbf r(t))$ in the direction of motion is found using the dot product with the unit tangent vector:

$$
\mathbf F(\mathbf r(t))\cdot \mathbf T(t).
$$

This is a scalar. It is positive if the field points partly with the motion, negative if it points partly against the motion, and zero if the field is perpendicular to the motion. Multiplying this tangential component by the small arc length $ds$ gives the small amount of work:

$$
dW=\mathbf F(\mathbf r(t))\cdot \mathbf T(t)\,ds.
$$

Substituting

$$
\mathbf T(t)=\frac{\mathbf r'(t)}{|\mathbf r'(t)|}
\qquad\text{and}\qquad
 ds=|\mathbf r'(t)|\,dt,
$$

we get

$$
dW=
\mathbf F(\mathbf r(t))\cdot
\frac{\mathbf r'(t)}{|\mathbf r'(t)|}
|\mathbf r'(t)|\,dt.
$$

The factor $|\mathbf r'(t)|$ cancels:

$$
dW=\mathbf F(\mathbf r(t))\cdot \mathbf r'(t)\,dt.
$$

This cancellation is one of the most important computational facts in this section. For a scalar line integral, the speed factor remains. For a vector line integral, the speed factor disappears because the unit tangent already divided by speed.

The line integral of the vector field $\mathbf F$ along the oriented curve $C$ is therefore defined by

$$
\int_C \mathbf F\cdot d\mathbf r
=
\int_a^b \mathbf F(\mathbf r(t))\cdot \mathbf r'(t)\,dt.
$$

The symbol $d\mathbf r$ means the infinitesimal displacement vector along the curve:

$$
d\mathbf r=\mathbf r'(t)\,dt.
$$

Since

$$
\mathbf r'(t)
=
\frac{dx}{dt}\mathbf i+
\frac{dy}{dt}\mathbf j+
\frac{dz}{dt}\mathbf k,
$$

we can also write

$$
d\mathbf r=dx\,\mathbf i+dy\,\mathbf j+dz\,\mathbf k.
$$

Thus the notation $\mathbf F\cdot d\mathbf r$ means that the vector field is dotted with the small directed displacement along the curve.

In component form, the formula becomes

$$
\int_C \mathbf F\cdot d\mathbf r
=
\int_C F_1\,dx+F_2\,dy+F_3\,dz.
$$

Here $F_1\,dx$ measures the contribution from the $x$-component of the field and the small change in $x$, $F_2\,dy$ measures the contribution from the $y$-component of the field and the small change in $y$, and $F_3\,dz$ measures the contribution from the $z$-component of the field and the small change in $z$.

In the plane, if

$$
\mathbf F(x,y)=P(x,y)\mathbf i+Q(x,y)\mathbf j,
$$

then

$$
\int_C \mathbf F\cdot d\mathbf r
=
\int_C P\,dx+Q\,dy.
$$

If the curve is parametrized by

$$
\mathbf r(t)=x(t)\mathbf i+y(t)\mathbf j,\qquad a\leq t\leq b,
$$

then

$$
\int_C P\,dx+Q\,dy
=
\int_a^b
\left[
P(x(t),y(t))\frac{dx}{dt}
+
Q(x(t),y(t))\frac{dy}{dt}
\right]dt.
$$

This is the most common practical formula for planar vector-field line integrals.

A common mistake is to confuse three different curve integrals that may use the same parametrization. The length of a curve is

$$
L=\int_a^b |\mathbf r'(t)|\,dt.
$$

A scalar line integral is

$$
\int_C f\,ds
=
\int_a^b f(\mathbf r(t))|\mathbf r'(t)|\,dt.
$$

A vector-field line integral is

$$
\int_C \mathbf F\cdot d\mathbf r
=
\int_a^b \mathbf F(\mathbf r(t))\cdot \mathbf r'(t)\,dt.
$$

The difference is not cosmetic. Length uses the speed $|\mathbf r'(t)|$. A scalar line integral also uses the speed because it accumulates a scalar quantity per unit length. A vector line integral uses $\mathbf r'(t)$, not $|\mathbf r'(t)|$, because it measures directed work along the path. In exam-style problems, the same curve may be used first for a length calculation and then for a work calculation, but the formulas are different.

Orientation matters for vector line integrals. If the same geometric curve is traversed in the opposite direction, then $d\mathbf r$ changes sign. Therefore,

$$
\int_{-C}\mathbf F\cdot d\mathbf r
=
-\int_C\mathbf F\cdot d\mathbf r,
$$

where $-C$ denotes the same curve with the opposite orientation. This is different from a scalar line integral $\int_C f\,ds$, because $ds$ is always a positive length element. Reversing direction does not change $ds$, but it does change $d\mathbf r$.

If $C$ is closed, meaning that its endpoint is the same as its starting point, then the vector line integral

$$
\oint_C \mathbf F\cdot d\mathbf r
$$

is called the circulation of $\mathbf F$ around $C$. The circle on the integral sign indicates that the curve is closed. Circulation measures the net tendency of the field to push around the closed loop in the chosen orientation. Reversing the orientation changes the sign of the circulation.

To see how the formula is used, consider the planar vector field

$$
\mathbf F(x,y)=x^2\mathbf i-y\mathbf j.
$$

We compute the line integral from $(0,0)$ to $(1,1)$ along two different paths.

First take the piecewise path that goes from $(0,0)$ to $(1,0)$, then from $(1,0)$ to $(1,1)$. On the first part, the curve lies on the $x$-axis, so $y=0$, $dy=0$, and $x$ runs from $0$ to $1$. Since

$$
\mathbf F\cdot d\mathbf r=x^2\,dx-y\,dy,
$$

the contribution from the first part is

$$
\int_0^1 x^2\,dx=\frac13.
$$

On the second part, $x=1$, $dx=0$, and $y$ runs from $0$ to $1$. The contribution is

$$
\int_0^1 -y\,dy=-\frac12.
$$

Therefore the total work along this piecewise path is

$$
\frac13-\frac12=-\frac16.
$$

Now take the curved path

$$
y=x^2
$$

from $(0,0)$ to $(1,1)$. A convenient parametrization is

$$
\mathbf r(t)=t\mathbf i+t^2\mathbf j,\qquad 0\leq t\leq 1.
$$

Then

$$
\mathbf r'(t)=\mathbf i+2t\mathbf j.
$$

Along the curve,

$$
\mathbf F(\mathbf r(t))
=
t^2\mathbf i-t^2\mathbf j.
$$

Thus

$$
\mathbf F(\mathbf r(t))\cdot \mathbf r'(t)
=
(t^2\mathbf i-t^2\mathbf j)\cdot(\mathbf i+2t\mathbf j)
=
t^2-2t^3.
$$

So the work along the parabolic path is

$$
\int_0^1 (t^2-2t^3)\,dt
=
\frac13-\frac12
=
-\frac16.
$$

In this example, the two paths give the same answer. This suggests that the field may have a potential function. Indeed, if there is a scalar function $\phi(x,y)$ such that

$$
\nabla\phi=\mathbf F,
$$

then

$$
\phi_x=x^2,\qquad \phi_y=-y.
$$

Integrating $\phi_x=x^2$ with respect to $x$ gives

$$
\phi(x,y)=\frac{x^3}{3}+g(y),
$$

where $g(y)$ appears because differentiating with respect to $x$ would make any function of $y$ disappear. Now differentiate this candidate with respect to $y$:

$$
\phi_y=g'(y).
$$

Since we need $\phi_y=-y$, we must have

$$
g'(y)=-y.
$$

Therefore

$$
g(y)=-\frac{y^2}{2}+C,
$$

where $C$ is a constant. One potential function is

$$
\phi(x,y)=\frac{x^3}{3}-\frac{y^2}{2}.
$$

Then

$$
\phi(1,1)-\phi(0,0)
=
\left(\frac13-\frac12\right)-0
=
-\frac16.
$$

This explains why both paths gave the same result.

A vector field that can be written as the gradient of a scalar function is called conservative. Thus $\mathbf F$ is conservative if there exists a scalar function $\phi$ such that

$$
\mathbf F=\nabla\phi.
$$

The function $\phi$ is called a potential function for $\mathbf F$. The gradient $\nabla\phi$ is the vector field whose components are the partial derivatives of $\phi$. In two dimensions,

$$
\nabla\phi
=
\phi_x\mathbf i+\phi_y\mathbf j.
$$

In three dimensions,

$$
\nabla\phi
=
\phi_x\mathbf i+\phi_y\mathbf j+\phi_z\mathbf k.
$$

Conservative vector fields are special because their line integrals depend only on the endpoints of the curve. This follows directly from the chain rule. Suppose

$$
\mathbf F=\nabla\phi
$$

and suppose $C$ is parametrized by $\mathbf r(t)$, $a\leq t\leq b$, with starting point

$$
P=\mathbf r(a)
$$

and endpoint

$$
Q=\mathbf r(b).
$$

Then

$$
\int_C \mathbf F\cdot d\mathbf r
=
\int_a^b \nabla\phi(\mathbf r(t))\cdot \mathbf r'(t)\,dt.
$$

By the chain rule,

$$
\frac{d}{dt}\phi(\mathbf r(t))
=
\nabla\phi(\mathbf r(t))\cdot \mathbf r'(t).
$$

Therefore,

$$
\int_C \mathbf F\cdot d\mathbf r
=
\int_a^b \frac{d}{dt}\phi(\mathbf r(t))\,dt.
$$

Using the one-variable Fundamental Theorem of Calculus,

$$
\int_a^b \frac{d}{dt}\phi(\mathbf r(t))\,dt
=
\phi(\mathbf r(b))-\phi(\mathbf r(a)).
$$

Since $\mathbf r(a)=P$ and $\mathbf r(b)=Q$, we obtain

$$
\int_C \mathbf F\cdot d\mathbf r
=
\phi(Q)-\phi(P).
$$

This formula is the main shortcut for conservative vector fields. Once a potential function is known, the path no longer has to be parametrized. Only the starting point and endpoint matter.

If $C$ is closed, then $P=Q$. Hence for a conservative vector field,

$$
\oint_C \mathbf F\cdot d\mathbf r
=
\phi(P)-\phi(P)
=
0.
$$

Thus every closed-curve integral of a conservative field is zero, provided the curve lies inside the domain where the potential is valid.

The sign convention in physics sometimes looks different. A conservative force is often written as

$$
\mathbf F=-\nabla U,
$$

where $U$ is a potential energy function. This is not a contradiction. It means that the potential energy decreases in the direction in which the force does positive work. If $\mathbf F=-\nabla U$, then

$$
\int_C \mathbf F\cdot d\mathbf r
=
-\int_C \nabla U\cdot d\mathbf r.
$$

Using the conservative-field formula for $\nabla U$,

$$
\int_C \nabla U\cdot d\mathbf r=U(Q)-U(P).
$$

Therefore

$$
\int_C \mathbf F\cdot d\mathbf r
=
U(P)-U(Q).
$$

So there are two closely related endpoint formulas:

$$
\mathbf F=\nabla\phi
\quad\Longrightarrow\quad
\int_C \mathbf F\cdot d\mathbf r=\phi(Q)-\phi(P),
$$

whereas

$$
\mathbf F=-\nabla U
\quad\Longrightarrow\quad
\int_C \mathbf F\cdot d\mathbf r=U(P)-U(Q).
$$

The difference is only the sign convention used for the potential.

A typical exam-style problem combines direct computation and the conservative shortcut. Consider

$$
\mathbf F(x,y)=-xy^2\mathbf i-x^2y\mathbf j.
$$

First compute the work along the curve

$$
y=\sqrt{x}
$$

from $(0,0)$ to $(3,\sqrt3)$. A convenient parametrization is

$$
\mathbf r(t)=t\mathbf i+\sqrt t\,\mathbf j,\qquad 0\leq t\leq 3.
$$

Then

$$
\mathbf r'(t)=\mathbf i+\frac{1}{2\sqrt t}\mathbf j.
$$

Along the curve,

$$
x=t,\qquad y=\sqrt t,
$$

so

$$
\mathbf F(\mathbf r(t))
=
-t(\sqrt t)^2\mathbf i-t^2\sqrt t\,\mathbf j
=
-t^2\mathbf i-t^{5/2}\mathbf j.
$$

Taking the dot product with $\mathbf r'(t)$,

$$
\mathbf F(\mathbf r(t))\cdot \mathbf r'(t)
=
(-t^2)\cdot 1+
(-t^{5/2})\cdot \frac{1}{2\sqrt t}.
$$

Since

$$
\frac{t^{5/2}}{\sqrt t}=t^2,
$$

we get

$$
\mathbf F(\mathbf r(t))\cdot \mathbf r'(t)
=
-t^2-\frac12t^2
=
-\frac32t^2.
$$

Therefore

$$
\int_C \mathbf F\cdot d\mathbf r
=
\int_0^3 -\frac32t^2\,dt
=
-\frac32\cdot\frac{t^3}{3}\Big|_0^3
=
-\frac12\cdot 27
=
-\frac{27}{2}.
$$

Now we check whether the same result can be obtained by a potential. The field has the form

$$
\mathbf F=-\nabla U
$$

if

$$
\nabla U=xy^2\mathbf i+x^2y\mathbf j.
$$

We need

$$
U_x=xy^2,\qquad U_y=x^2y.
$$

Integrating $U_x=xy^2$ with respect to $x$,

$$
U(x,y)=\frac12x^2y^2+g(y).
$$

Differentiating this with respect to $y$,

$$
U_y=x^2y+g'(y).
$$

Since we need $U_y=x^2y$, we get

$$
g'(y)=0.
$$

Thus $g(y)$ is constant, and one potential energy function is

$$
U(x,y)=\frac12x^2y^2.
$$

For any path from $P=(0,0)$ to $Q=(3,\sqrt3)$, the work is

$$
W=U(P)-U(Q).
$$

Now

$$
U(0,0)=0,
$$

and

$$
U(3,\sqrt3)
=
\frac12(3)^2(\sqrt3)^2
=
\frac12\cdot 9\cdot 3
=
\frac{27}{2}.
$$

Therefore

$$
W=0-\frac{27}{2}
=
-\frac{27}{2}.
$$

This proves that if the field is written as $\mathbf F=-\nabla U$, then the same work is obtained along every path between the same endpoints. A straight line from $(0,0)$ to $(3,\sqrt3)$, the curve $y=\sqrt{x}$, and any other curve staying in the domain all give the same answer.

Not every vector field is conservative. When a field is not conservative, the path matters. A useful example is the field

$$
\mathbf F(x,y)=y^2\mathbf i+2xy\mathbf j.
$$

This field is conservative because

$$
\phi(x,y)=xy^2
$$

satisfies

$$
\nabla\phi
=
y^2\mathbf i+2xy\mathbf j.
$$

Therefore every path from $(0,0)$ to $(1,1)$ gives

$$
\phi(1,1)-\phi(0,0)=1-0=1.
$$

This is why the straight line, a parabola, and a piecewise path between these endpoints all give the same integral. In a conservative field, different paths can look very different geometrically, but the vector line integral only sees the endpoints.

By contrast, consider

$$
\mathbf F(x,y)=-y\mathbf i+x\mathbf j.
$$

This field rotates around the origin. From $(1,0)$ to $(0,1)$, take the straight line

$$
\mathbf r(t)=(1-t)\mathbf i+t\mathbf j,\qquad 0\leq t\leq 1.
$$

Then

$$
\mathbf r'(t)=-\mathbf i+\mathbf j,
$$

and

$$
\mathbf F(\mathbf r(t))=-t\mathbf i+(1-t)\mathbf j.
$$

Thus

$$
\mathbf F(\mathbf r(t))\cdot \mathbf r'(t)
=
t+(1-t)=1,
$$

so

$$
\int_C\mathbf F\cdot d\mathbf r
=
\int_0^1 1\,dt
=
1.
$$

Now take the quarter circle

$$
\mathbf r(t)=\cos t\,\mathbf i+\sin t\,\mathbf j,
\qquad
0\leq t\leq \frac{\pi}{2}.
$$

Then

$$
\mathbf r'(t)=-\sin t\,\mathbf i+\cos t\,\mathbf j.
$$

Along this curve,

$$
\mathbf F(\mathbf r(t))=-\sin t\,\mathbf i+\cos t\,\mathbf j.
$$

Therefore,

$$
\mathbf F(\mathbf r(t))\cdot \mathbf r'(t)
=
\sin^2 t+\cos^2 t
=
1.
$$

Hence

$$
\int_C\mathbf F\cdot d\mathbf r
=
\int_0^{\pi/2}1\,dt
=
\frac{\pi}{2}.
$$

The endpoints are the same, but the answers are different. Therefore this vector field is not conservative. For a non-conservative field, the path must be specified and used.

![pasted 1782029334539](/math-2/assets/pasted-1782029334539.png)

To use conservative-field tests correctly, the domain of the field must be understood. A domain is called connected if any two points in it can be joined by a piecewise smooth curve that stays inside the domain. Intuitively, connected means “one piece.” A domain is called simply connected if every simple closed curve in it can be continuously shrunk to a point without leaving the domain. In the plane, simply connected means one piece with no holes.

A disk is simply connected. An annulus is connected but not simply connected, because a loop around the hole cannot be shrunk to a point without crossing the missing middle. The punctured plane

$$
\mathbb R^2\setminus\{(0,0)\}
$$

is connected but not simply connected, because the missing origin acts like a hole.

The domain matters because the derivative test for conservative fields requires a simply connected domain. Let

$$
\mathbf F=(f_1,f_2,\ldots,f_d)
$$

be a continuously differentiable vector field on a simply connected domain $D\subseteq \mathbb R^d$, where $d=2$ or $d=3$. Then $\mathbf F$ is conservative precisely when its mixed component derivatives match:

$$
\frac{\partial f_i}{\partial x_j}
=
\frac{\partial f_j}{\partial x_i}
\qquad
\text{for all }1\leq i,j\leq d.
$$

This condition says that the derivative matrix $D\mathbf F$ is symmetric. In two dimensions, if

$$
\mathbf F(x,y)=P(x,y)\mathbf i+Q(x,y)\mathbf j,
$$

then the test becomes

$$
P_y=Q_x.
$$

Here $P_y$ means $\partial P/\partial y$, and $Q_x$ means $\partial Q/\partial x$. In three dimensions, if

$$
\mathbf F(x,y,z)=P\mathbf i+Q\mathbf j+R\mathbf k,
$$

then the corresponding conditions are

$$
P_y=Q_x,\qquad P_z=R_x,\qquad Q_z=R_y.
$$

These equalities are necessary for a conservative field. On a simply connected domain, they are also sufficient. Without the simply connected assumption, they may not be sufficient.

The standard warning example is

$$
\mathbf F(x,y)=\frac{-y\mathbf i+x\mathbf j}{x^2+y^2},
\qquad (x,y)\neq (0,0).
$$

This field is not defined at the origin, so its domain is the punctured plane. The punctured plane has a hole. On its domain, the field has the local derivative symmetry one expects from a conservative-looking field, but it still has nonzero circulation around curves that enclose the missing origin.

Take the circle

$$
x^2+y^2=2
$$

with counterclockwise orientation. A parametrization is

$$
\mathbf r(t)=\sqrt2\cos t\,\mathbf i+\sqrt2\sin t\,\mathbf j,
\qquad
0\leq t\leq 2\pi.
$$

Then

$$
\mathbf r'(t)
=
-\sqrt2\sin t\,\mathbf i+\sqrt2\cos t\,\mathbf j.
$$

Along the circle,

$$
x=\sqrt2\cos t,\qquad y=\sqrt2\sin t,
$$

so

$$
x^2+y^2=2.
$$

Therefore

$$
\mathbf F(\mathbf r(t))
=
\frac{-\sqrt2\sin t\,\mathbf i+\sqrt2\cos t\,\mathbf j}{2}.
$$

The dot product is

$$
\mathbf F(\mathbf r(t))\cdot \mathbf r'(t)
=
\frac{2\sin^2t+2\cos^2t}{2}
=
1.
$$

Thus

$$
\oint_C \mathbf F\cdot d\mathbf r
=
\int_0^{2\pi}1\,dt
=
2\pi.
$$

The same circulation is obtained around the square

$$
[-1,1]\times[-1,1]
$$

with counterclockwise orientation. This can be seen by computing the four sides. On the bottom side, $y=-1$, $x$ goes from $1$ to $-1$, and $dy=0$. Thus

$$
\mathbf F\cdot d\mathbf r
=
\frac{-y}{x^2+y^2}\,dx
=
\frac{1}{x^2+1}\,dx,
$$

so the bottom contribution is

$$
\int_1^{-1}\frac{1}{x^2+1}\,dx
=
-\frac{\pi}{2}.
$$

However, this orientation is clockwise along the bottom if we start at $(1,-1)$ and follow the square upward first. To avoid sign confusion, choose the counterclockwise path starting at $(1,-1)$: go right-to-left along the bottom, then up the left side, then left-to-right along the top, then down the right side. The four oriented contributions all have the same sign after the correct $dx$ and $dy$ directions are used, and their total is

$$
2\pi.
$$

The important lesson is not that circles and squares are special. The important lesson is that a closed curve winding once counterclockwise around the missing origin has circulation $2\pi$. The hole in the domain is responsible for the failure of global path independence.

In practical problem solving, there are two main methods.

If the field is not known to be conservative, parametrize the actual curve in the correct direction and compute

$$
\int_a^b \mathbf F(\mathbf r(t))\cdot \mathbf r'(t)\,dt.
$$

For a piecewise curve, compute each piece separately and add the results.

If the field is conservative, find a potential function and use endpoints. If

$$
\mathbf F=\nabla\phi,
$$

then

$$
\int_C\mathbf F\cdot d\mathbf r=\phi(Q)-\phi(P).
$$

If

$$
\mathbf F=-\nabla U,
$$

then

$$
\int_C\mathbf F\cdot d\mathbf r=U(P)-U(Q).
$$

If the curve is closed and the field is conservative on a domain containing the whole curve, the integral is immediately zero.

To find a potential in two dimensions, start from

$$
\mathbf F=P\mathbf i+Q\mathbf j.
$$

A potential $\phi$ must satisfy

$$
\phi_x=P,\qquad \phi_y=Q.
$$

Integrate $P$ with respect to $x$:

$$
\phi(x,y)=\int P(x,y)\,dx+g(y).
$$

The function $g(y)$ is included because any function of $y$ disappears when differentiated with respect to $x$. Then differentiate the candidate $\phi$ with respect to $y$, set it equal to $Q$, and solve for $g(y)$. In three dimensions, the same idea is used, but after integrating one component, the missing function may depend on the other two variables.

There is one adjacent idea that often appears near these problems: streamlines. A streamline of a vector field is a curve whose tangent direction agrees with the vector field at each point. This is different from a vector line integral. A vector line integral asks how much the field pushes along a given curve. A streamline asks which curve naturally follows the field direction. For a vector field

$$
\mathbf F=P(x,y)\mathbf i+Q(x,y)\mathbf j,
$$

a streamline can be found from the differential relation

$$
\frac{dy}{dx}=\frac{Q(x,y)}{P(x,y)},
$$

where this formula is used only where $P(x,y)\neq 0$. This belongs mainly to the study of field lines, but it is worth distinguishing because exam questions may place streamline questions next to work and conservative-field questions. Work, potential, and path independence belong to the line-integral method; streamlines describe the geometry of the vector field itself.

The central idea of this section is that a vector line integral measures accumulated tangential push along an oriented curve. The computational formula

$$
\int_C \mathbf F\cdot d\mathbf r
=
\int_a^b \mathbf F(\mathbf r(t))\cdot \mathbf r'(t)\,dt
$$

comes from resolving the field into the direction of motion. The direction matters: reversing the curve changes the sign. Closed-curve integrals measure circulation. Conservative fields are the special fields for which the integral depends only on endpoints, so closed-loop integrals vanish. The derivative test for conservativeness is powerful, but it must be applied together with the correct domain condition. In every problem, the safest sequence is to identify the curve and its orientation, decide whether a conservative shortcut is valid, and then compute either by parametrization or by a potential function.
