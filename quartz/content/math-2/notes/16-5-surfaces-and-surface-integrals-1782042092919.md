---
title: "16.5 Surfaces and Surface Integrals"
date: "2026-06-21T11:41:32.919Z"
source: "user-note"
knowledge_type: "user-note"
---

# 16.5 Surfaces and Surface Integrals

In the previous parts of the course, integration was extended step by step from intervals to larger geometric objects. A single integral adds up a quantity along an interval. A double integral adds up a quantity over a flat two-dimensional region. A triple integral adds up a quantity throughout a three-dimensional solid. A line integral adds up a quantity along a curve. The next natural object is a curved two-dimensional surface in three-dimensional space, such as a sphere, cone, cylinder, paraboloid, shell, membrane, or graph $z=f(x,y)$.

The problem solved in this section is the following: how do we add up a scalar quantity that is spread over a curved surface? For example, if a thin curved sheet has density depending on position, then its total mass is obtained by adding density times small pieces of surface area. If the scalar quantity is simply $1$, then the same integral gives the area of the surface itself. The new difficulty is not the idea of integration, but the correct expression for a small piece of curved surface area.

A surface integral is therefore the surface analogue of a double integral. The difference is that the domain of integration is not necessarily a flat region in the $xy$-plane. It may bend through three-dimensional space. To handle this, we describe the surface using parameters and then convert the integral over the curved surface into an ordinary double integral over a flat parameter domain.

![pasted 1782042558985](/math-2/assets/pasted-1782042558985.png)

A curve is one-dimensional, so one parameter is usually enough to describe it. A surface is two-dimensional, so two parameters are usually needed. A parametric surface is a vector-valued function of two variables,

$$
\mathbf r(u,v)=x(u,v)\mathbf i+y(u,v)\mathbf j+z(u,v)\mathbf k.
$$

The parameters $u$ and $v$ range over a region $\mathcal D$ in the $uv$-plane. The function $\mathbf r$ sends each pair $(u,v)$ to the point

$$
(x(u,v),y(u,v),z(u,v))
$$

in three-dimensional space. The region $\mathcal D$ is called the parameter domain. The surface $S$ is the set of points traced out by $\mathbf r(u,v)$ as $(u,v)$ moves through $\mathcal D$.

A simple example is the graph of a function $z=g(x,y)$. Since the height $z$ is already determined by the two coordinates $x$ and $y$, we can use $x$ and $y$ themselves as parameters:

$$
\mathbf r(x,y)=x\mathbf i+y\mathbf j+g(x,y)\mathbf k.
$$

Here the parameter domain is the domain of $g$ in the $xy$-plane. This parametrization says: start from a point $(x,y)$ in the base region, then move vertically to the height $z=g(x,y)$.

A sphere gives a different type of example. The sphere of radius $a$ centred at the origin can be parametrized by

$$
\mathbf r(\phi,\theta)=a\sin\phi\cos\theta\,\mathbf i+a\sin\phi\sin\theta\,\mathbf j+a\cos\phi\,\mathbf k,
$$

where $0\leq \phi\leq \pi$ and $0\leq \theta\leq 2\pi$. The parameter $\phi$ is the angle measured down from the positive $z$-axis, and $\theta$ is the angle around the $z$-axis. If $0\leq \phi\leq \pi/2$, the parametrization covers only the upper hemisphere. This example is important because a sphere cannot be represented globally as one graph $z=g(x,y)$, but it can still be represented naturally as a parametric surface.

An ellipsoid can be parametrized in the same spirit. The surface

$$
\frac{x^2}{a^2}+\frac{y^2}{b^2}+\frac{z^2}{c^2}=1
$$

may be described by

$$
\mathbf r(u,v)=a\cos u\sin v\,\mathbf i+b\sin u\sin v\,\mathbf j+c\cos v\,\mathbf k,
$$

where $0\leq u\leq 2\pi$ and $0\leq v\leq \pi$. The formula is a stretched version of the spherical parametrization: the $x$-coordinate is scaled by $a$, the $y$-coordinate by $b$, and the $z$-coordinate by $c$.

A parametrization is not unique. The same surface can often be parametrized in several different ways. What matters is that the chosen parametrization describes the surface correctly and covers it once, except possibly along boundary curves. If a parametrization covers the same surface twice, then a surface integral computed from it will usually count the surface twice. Therefore the parameter bounds are part of the mathematics, not just a technical detail. When angles are used, one must always check whether the interval traces the surface once or repeats it.

A surface can also be built from several smooth pieces. Such a surface is called piecewise smooth. The surface of a cube, for example, consists of six flat square faces. A cone together with its base consists of a curved lateral surface and a flat disk. For scalar surface integrals, the rule is simple: integrate over each smooth piece and add the results. No new principle is needed; the surface is just split into simpler pieces.

![pasted 1782042585391](/math-2/assets/pasted-1782042585391.png)

To integrate over a surface, we need a formula for a small piece of surface area. Suppose

$$
\mathbf r(u,v)=x(u,v)\mathbf i+y(u,v)\mathbf j+z(u,v)\mathbf k
$$

parametrizes a surface. If we change $u$ while keeping $v$ fixed, we move along a curve on the surface. The tangent vector in that direction is

$$
\mathbf r_u=\frac{\partial \mathbf r}{\partial u}.
$$

If we change $v$ while keeping $u$ fixed, we move along another curve on the surface. The tangent vector in that direction is

$$
\mathbf r_v=\frac{\partial \mathbf r}{\partial v}.
$$

For a very small rectangle $du\,dv$ in the parameter plane, the corresponding surface patch is approximately a parallelogram spanned by the vectors $\mathbf r_u\,du$ and $\mathbf r_v\,dv$. The area of a parallelogram spanned by two vectors is the magnitude of their cross product. Therefore the surface area element is

$$
dS=\left|\mathbf r_u\times\mathbf r_v\right|\,du\,dv.
$$

Here $dS$ means a small area on the actual curved surface. The symbol $du\,dv$ means a small flat area in the parameter domain. The factor

$$
\left|\mathbf r_u\times\mathbf r_v\right|
$$

converts parameter-area into true surface-area. This is the central formula of the section.

It is important that the magnitude is used. The cross product $\mathbf r_u\times\mathbf r_v$ is a vector, but a scalar surface integral needs an area, and area cannot be negative. Thus the scalar area factor is

$$
\left|\mathbf r_u\times\mathbf r_v\right|,
$$

not merely $\mathbf r_u\times\mathbf r_v$. In this section, the direction of the cross product is not part of the scalar integral; only its length is used.

The cross product can be computed by the determinant

$$
\mathbf r_u\times\mathbf r_v=
\begin{vmatrix}
\mathbf i & \mathbf j & \mathbf k\\
x_u & y_u & z_u\\
x_v & y_v & z_v
\end{vmatrix}.
$$

Here

$$
x_u=\frac{\partial x}{\partial u},\qquad
 y_u=\frac{\partial y}{\partial u},\qquad
 z_u=\frac{\partial z}{\partial u},
$$

and similarly $x_v,y_v,z_v$ are the partial derivatives with respect to $v$. Equivalently,

$$
\mathbf r_u\times\mathbf r_v=
\frac{\partial(y,z)}{\partial(u,v)}\mathbf i
+
\frac{\partial(z,x)}{\partial(u,v)}\mathbf j
+
\frac{\partial(x,y)}{\partial(u,v)}\mathbf k.
$$

This form shows that surface area is closely related to Jacobian determinants. A small parameter rectangle is stretched into a small surface parallelogram, and the cross product measures the amount of stretching.

Now let $f(x,y,z)$ be a scalar function defined on a surface $S$. The scalar surface integral of $f$ over $S$ is written

$$
\iint_S f(x,y,z)\,dS.
$$

The meaning is: split the surface into tiny pieces, evaluate $f$ on each piece, multiply by the area of that piece, and add the contributions. If $S$ is parametrized by $\mathbf r(u,v)$ over the parameter domain $\mathcal D$, then

$$
\iint_S f(x,y,z)\,dS
=
\iint_{\mathcal D}
f(\mathbf r(u,v))
\left|\mathbf r_u\times\mathbf r_v\right|
\,du\,dv.
$$

In this formula, $f(\mathbf r(u,v))$ means that $x,y,z$ are replaced by $x(u,v),y(u,v),z(u,v)$. The integral on the left is over the curved surface, while the integral on the right is an ordinary double integral over the flat parameter domain.

This formula includes surface area as a special case. If $f=1$, then

$$
\iint_S 1\,dS=\iint_S dS
$$

is the area of $S$. If $f=\sigma(x,y,z)$, where $\sigma$ is an areal density, then

$$
\iint_S \sigma(x,y,z)\,dS
$$

gives the total mass or total charge distributed over a thin surface, depending on what $\sigma$ represents. If $f=x^2+y^2$, then the integral over a shell measures a rotational quantity about the $z$-axis when the surface has unit areal density.

![pasted 1782042612208](/math-2/assets/pasted-1782042612208.png)

The most important special case is a graph

$$
z=g(x,y).
$$

Parametrize the graph by

$$
\mathbf r(x,y)=x\mathbf i+y\mathbf j+g(x,y)\mathbf k.
$$

Then

$$
\mathbf r_x=(1,0,g_x),
\qquad
\mathbf r_y=(0,1,g_y),
$$

where

$$
g_x=\frac{\partial g}{\partial x},
\qquad
g_y=\frac{\partial g}{\partial y}.
$$

Their cross product is

$$
\mathbf r_x\times\mathbf r_y=(-g_x,-g_y,1),
$$

so its magnitude is

$$
\left|\mathbf r_x\times\mathbf r_y\right|=
\sqrt{1+g_x^2+g_y^2}.
$$

Therefore, for a graph $z=g(x,y)$ over a domain $D$ in the $xy$-plane,

$$
dS=\sqrt{1+g_x(x,y)^2+g_y(x,y)^2}\,dx\,dy.
$$

The surface integral becomes

$$
\iint_S f(x,y,z)\,dS
=
\iint_D
f(x,y,g(x,y))
\sqrt{1+g_x(x,y)^2+g_y(x,y)^2}
\,dx\,dy.
$$

This formula has a simple geometric meaning. If the surface is horizontal, then $g_x=g_y=0$, so

$$
dS=dx\,dy.
$$

The surface patch has the same area as its projection. If the surface is tilted, then

$$
\sqrt{1+g_x^2+g_y^2}>1,
$$

so the true surface area is larger than the projected area in the $xy$-plane.

The expression $dx\,dy$ is not the same as $dS$. The symbol $dx\,dy$ measures area in the flat $xy$-plane. The symbol $dS$ measures area on the curved surface. The factor

$$
\sqrt{1+g_x^2+g_y^2}
$$

is precisely the correction from projected flat area to actual surface area.

A useful exam-style surface is

$$
S=\{(x,y,z)\in\mathbb R^3:x^2-2x+y^2=z^2,\ 0\leq z\leq 1\}.
$$

Before parametrizing, rewrite the equation by completing the square:

$$
x^2-2x+y^2=z^2
$$

becomes

$$
(x-1)^2+y^2=1+z^2.
$$

For each fixed $z$, this is a circle in the $xy$-plane centred at $(1,0)$ with radius

$$
\sqrt{1+z^2}.
$$

Let $u$ be the angle around this circle, and let $v=z$. Then a natural parametrization is

$$
\mathbf r(u,v)=
\left(1+\sqrt{1+v^2}\cos u\right)\mathbf i
+
\sqrt{1+v^2}\sin u\,\mathbf j
+
v\mathbf k,
$$

where

$$
0\leq u\leq 2\pi,
\qquad
0\leq v\leq 1.
$$

This parametrization is not guessed blindly. The shift $1$ in the $x$-coordinate comes from the centre $(1,0)$, the radius $\sqrt{1+v^2}$ comes from the rewritten equation, $u$ moves around the circle, and $v$ moves through the allowed height interval.

To compute its area, write

$$
R(v)=\sqrt{1+v^2}.
$$

Then

$$
\mathbf r_u=(-R\sin u,\ R\cos u,\ 0),
$$

and

$$
\mathbf r_v=
\left(\frac{v}{R}\cos u,\ \frac{v}{R}\sin u,\ 1\right).
$$

The cross product is

$$
\mathbf r_u\times\mathbf r_v=(R\cos u,\ R\sin u,\ -v).
$$

Therefore,

$$
\left|\mathbf r_u\times\mathbf r_v\right|
=
\sqrt{R^2\cos^2u+R^2\sin^2u+v^2}
=
\sqrt{R^2+v^2}.
$$

Since $R^2=1+v^2$, this becomes

$$
\left|\mathbf r_u\times\mathbf r_v\right|=
\sqrt{1+2v^2}.
$$

Thus the surface area is

$$
\operatorname{Area}(S)
=
\int_0^{2\pi}\int_0^1
\sqrt{1+2v^2}\,dv\,du.
$$

Because the integrand does not depend on $u$, this simplifies to

$$
\operatorname{Area}(S)
=
2\pi\int_0^1\sqrt{1+2v^2}\,dv.
$$

This is the expected final form if the problem asks for the answer as a constant times a one-variable integral. The essential work is setting up the parametrization correctly and finding the surface element.

The same surface can also be treated as a graph if one solves for $z$. Since

$$
z=\sqrt{x^2-2x+y^2}
$$

on the upper part of the surface, the graph formula can be used over the corresponding projection domain in the $xy$-plane. This gives the same answer when the projection and bounds are chosen correctly. In practice, the parametrization above is often cleaner because the cross-sections are circles.

A second way to obtain $dS$ applies when a surface is given implicitly by an equation

$$
G(x,y,z)=0.
$$

Suppose the surface projects one-to-one onto a domain $D$ in the $xy$-plane, and suppose

$$
G_z=\frac{\partial G}{\partial z}\neq 0
$$

on the surface. The gradient

$$
\nabla G=(G_x,G_y,G_z)
$$

is perpendicular to the level surface $G=0$. This fact gives the surface area element

$$
dS=
\frac{|\nabla G(x,y,z)|}{|G_z(x,y,z)|}\,dx\,dy.
$$

Here

$$
|\nabla G|=
\sqrt{G_x^2+G_y^2+G_z^2}.
$$

The denominator is $|G_z|$ because the surface is being projected onto the $xy$-plane. If the surface is projected onto the $xz$-plane, the corresponding denominator is $|G_y|$. If the surface is projected onto the $yz$-plane, the denominator is $|G_x|$.

The corresponding scalar surface integral is

$$
\iint_S f(x,y,z)\,dS
=
\iint_D
f(x,y,z)
\frac{|\nabla G(x,y,z)|}{|G_z(x,y,z)|}
\,dx\,dy,
$$

where $z$ is understood as the value on the surface. This formula is useful when the surface equation is easier to use than an explicit parametrization.

For example, consider the cone

$$
z=\sqrt{x^2+y^2}
$$

between $z=0$ and $z=1$. Since this is already a graph, let

$$
g(x,y)=\sqrt{x^2+y^2}.
$$

On the cone,

$$
g_x=\frac{x}{\sqrt{x^2+y^2}}=\frac{x}{z},
\qquad
g_y=\frac{y}{\sqrt{x^2+y^2}}=\frac{y}{z}.
$$

The graph formula gives

$$
dS=
\sqrt{1+\frac{x^2}{z^2}+\frac{y^2}{z^2}}\,dx\,dy.
$$

Because $z^2=x^2+y^2$ on the cone,

$$
\frac{x^2+y^2}{z^2}=1,
$$

so

$$
dS=\sqrt{2}\,dx\,dy.
$$

![pasted 1782042631262](/math-2/assets/pasted-1782042631262.png)

If we want to compute

$$
\iint_S z\,dS
$$

over the part of the cone with $0\leq z\leq 1$, the projection onto the $xy$-plane is the disk

$$
x^2+y^2\leq 1.
$$

On the cone, $z=\sqrt{x^2+y^2}$. In polar coordinates,

$$
z=r,
\qquad
 dx\,dy=r\,dr\,d\theta.
$$

Therefore,

$$
\iint_S z\,dS
=
\sqrt{2}\iint_{x^2+y^2\leq 1} z\,dx\,dy
$$

becomes

$$
\iint_S z\,dS
=
\sqrt{2}
\int_0^{2\pi}\int_0^1
r\cdot r\,dr\,d\theta.
$$

The first $r$ is the value of $z$ on the cone. The second $r$ comes from the polar area element $dx\,dy=r\,dr\,d\theta$. Thus

$$
\iint_S z\,dS
=
\sqrt{2}\int_0^{2\pi}\int_0^1 r^2\,dr\,d\theta
=
\frac{2\pi\sqrt2}{3}.
$$

This example is a useful warning. When polar coordinates are used, an $r$ may come from the function being integrated, from the surface equation, or from the polar area element. These roles must not be confused.

For spherical surfaces, there is a standard surface area element. On the sphere

$$
R=a,
$$

we may use the spherical parametrization

$$
x=a\sin\phi\cos\theta,
\qquad
y=a\sin\phi\sin\theta,
\qquad
z=a\cos\phi.
$$

The surface area element is

$$
dS=a^2\sin\phi\,d\phi\,d\theta.
$$

This is different from the spherical volume element

$$
dV=R^2\sin\phi\,dR\,d\phi\,d\theta.
$$

The distinction is essential. On the sphere $R=a$, the radius is fixed, so there is no $dR$. The element $dS$ measures a thin surface; the element $dV$ measures a solid volume.

As an example, consider the surface integral

$$
\iint_S z^2\,dS
$$

over the upper hemisphere

$$
z=\sqrt{a^2-x^2-y^2}.
$$

On the sphere,

$$
z=a\cos\phi,
$$

and over the upper hemisphere the bounds are

$$
0\leq \theta\leq 2\pi,
\qquad
0\leq \phi\leq \frac{\pi}{2}.
$$

Using

$$
dS=a^2\sin\phi\,d\phi\,d\theta,
$$

we obtain

$$
\iint_S z^2\,dS
=
\int_0^{2\pi}\int_0^{\pi/2}
a^2\cos^2\phi\cdot a^2\sin\phi
\,d\phi\,d\theta.
$$

Thus

$$
\iint_S z^2\,dS
=
2\pi a^4\int_0^{\pi/2}\cos^2\phi\sin\phi\,d\phi.
$$

Let

$$
w=\cos\phi,
\qquad
dw=-\sin\phi\,d\phi.
$$

When $\phi=0$, $w=1$, and when $\phi=\pi/2$, $w=0$. Therefore,

$$
\int_0^{\pi/2}\cos^2\phi\sin\phi\,d\phi
=
\int_0^1 w^2\,dw
=
\frac13.
$$

Hence

$$
\iint_S z^2\,dS
=
\frac{2\pi a^4}{3}.
$$

The same spherical element can be used for the moment of inertia of a uniform spherical shell about the $z$-axis. For unit areal density, the relevant integral is

$$
\iint_S (x^2+y^2)\,dS.
$$

On the sphere $x^2+y^2+z^2=a^2$,

$$
x^2+y^2=a^2\sin^2\phi,
$$

so

$$
\iint_S (x^2+y^2)\,dS
=
\int_0^{2\pi}\int_0^\pi
a^2\sin^2\phi\cdot a^2\sin\phi
\,d\phi\,d\theta.
$$

Thus

$$
\iint_S (x^2+y^2)\,dS
=
2\pi a^4\int_0^\pi \sin^3\phi\,d\phi.
$$

Since

$$
\int_0^\pi \sin^3\phi\,d\phi=\frac43,
$$

we get

$$
\iint_S (x^2+y^2)\,dS
=
\frac{8\pi a^4}{3}.
$$

If the shell has constant areal density $\sigma$, then the moment of inertia is multiplied by $\sigma$.

![pasted 1782042652758](/math-2/assets/pasted-1782042652758.png)

Sometimes the most efficient method is not to compute a full cross product. If the geometry gives the area element directly, use it. Consider the part of the cylinder

$$
x^2+y^2=2ay
$$

that lies inside the sphere

$$
x^2+y^2+z^2=4a^2.
$$

The cylinder is generated by vertical lines above the circle

$$
x^2+y^2=2ay
$$

in the $xy$-plane. In polar coordinates, this circle becomes

$$
r^2=2ar\sin\theta,
$$

so, away from the origin,

$$
r=2a\sin\theta.
$$

On the sphere, the positive height is

$$
z=\sqrt{4a^2-r^2}.
$$

A vertical strip on the cylinder has area equal to height times a small arc-length element along the base curve. Thus, on the upper half,

$$
dS=z\,ds.
$$

The polar arc-length element for a plane curve $r=r(\theta)$ is

$$
ds=
\sqrt{r^2+\left(\frac{dr}{d\theta}\right)^2}\,d\theta.
$$

For

$$
r=2a\sin\theta,
$$

we have

$$
\frac{dr}{d\theta}=2a\cos\theta.
$$

Therefore,

$$
ds
=
\sqrt{4a^2\sin^2\theta+4a^2\cos^2\theta}\,d\theta
=
2a\,d\theta.
$$

One quarter of the total cylindrical surface lies in the first octant. By symmetry, the total area is four times the first-octant area:

$$
A
=
4\int_0^{\pi/2}
\sqrt{4a^2-r^2}\,2a\,d\theta.
$$

Substituting $r=2a\sin\theta$, we get

$$
A
=
4\int_0^{\pi/2}
\sqrt{4a^2-4a^2\sin^2\theta}\,2a\,d\theta.
$$

Since

$$
\sqrt{4a^2(1-\sin^2\theta)}
=
2a\cos\theta
$$

on $0\leq\theta\leq\pi/2$, this becomes

$$
A
=
4\int_0^{\pi/2}
2a\cos\theta\cdot 2a\,d\theta
=
16a^2\int_0^{\pi/2}\cos\theta\,d\theta.
$$

Therefore,

$$
A=16a^2.
$$

This example shows that $dS$ does not always have to be found by memorized formulas. It can often be built from simpler geometric pieces: here, height times arc length.

A final example combines the graph formula with polar-coordinate bounds. Suppose

$$
S=\{(x,y,z):(x,y)\in D,\ z=4-x^2-y^2\},
$$

where

$$
D=\{(x,y):2y\leq x^2+y^2\leq 4,\ x\geq 0,\ y\geq 0\}.
$$

Let the scalar density on the surface be

$$
\rho(x,y,z)=\frac{x}{x^2+y^2}.
$$

The total amount on the surface is

$$
\iint_S \rho\,dS.
$$

Because this is a graph with

$$
g(x,y)=4-x^2-y^2,
$$

we compute

$$
g_x=-2x,
\qquad
g_y=-2y.
$$

Hence

$$
dS=\sqrt{1+4x^2+4y^2}\,dx\,dy.
$$

Now use polar coordinates in the projection domain:

$$
x=r\cos\theta,
\qquad
y=r\sin\theta.
$$

Then

$$
\rho=\frac{r\cos\theta}{r^2}=\frac{\cos\theta}{r},
$$

and

$$
dS=\sqrt{1+4r^2}\,dx\,dy
=
\sqrt{1+4r^2}\,r\,dr\,d\theta.
$$

Therefore,

$$
\rho\,dS
=
\cos\theta\sqrt{1+4r^2}\,dr\,d\theta.
$$

The conditions $x\geq0$ and $y\geq0$ give

$$
0\leq\theta\leq\frac{\pi}{2}.
$$

The condition $x^2+y^2\leq 4$ gives

$$
r\leq 2.
$$

The condition

$$
2y\leq x^2+y^2
$$

becomes

$$
2r\sin\theta\leq r^2.
$$

For $r>0$, this is

$$
r\geq 2\sin\theta.
$$

Thus one valid setup is

$$
\iint_S \rho\,dS
=
\int_0^{\pi/2}\int_{2\sin\theta}^{2}
\cos\theta\sqrt{1+4r^2}\,dr\,d\theta.
$$

The order can be improved by describing the same region using $r$ first. Since

$$
r\geq 2\sin\theta
$$

is equivalent to

$$
\sin\theta\leq\frac r2,
$$

we can write

$$
0\leq r\leq 2,
\qquad
0\leq \theta\leq \arcsin\left(\frac r2\right).
$$

Then

$$
\iint_S \rho\,dS
=
\int_0^2\int_0^{\arcsin(r/2)}
\cos\theta\sqrt{1+4r^2}\,d\theta\,dr.
$$

The inner integral is now simple:

$$
\int_0^{\arcsin(r/2)}\cos\theta\,d\theta
=
\sin\left(\arcsin\frac r2\right)
=
\frac r2.
$$

Therefore,

$$
\iint_S \rho\,dS
=
\frac12\int_0^2 r\sqrt{1+4r^2}\,dr.
$$

Let

$$
w=1+4r^2,
\qquad
dw=8r\,dr.
$$

Then

$$
\frac12 r\,dr=\frac{1}{16}\,dw.
$$

When $r=0$, $w=1$. When $r=2$, $w=17$. Hence

$$
\iint_S \rho\,dS
=
\frac{1}{16}\int_1^{17}w^{1/2}\,dw
=
\frac{1}{16}\cdot\frac{2}{3}w^{3/2}\Big|_1^{17}.
$$

Thus

$$
\iint_S \rho\,dS
=
\frac{1}{24}\left(17^{3/2}-1\right).
$$

This example illustrates the full surface-integral workflow. First identify the surface type. Then find $dS$. Then rewrite the scalar quantity on the surface. Then describe the correct parameter or projection domain. Finally, choose bounds that make the integral as simple as possible.

The central idea of this section is that a curved surface can be integrated over by flattening its description into two parameters. The parametrization produces two tangent vectors, and the magnitude of their cross product gives the conversion from parameter area to true surface area. For graphs, this becomes the familiar correction factor $\sqrt{1+g_x^2+g_y^2}$. For implicit surfaces, the gradient gives an efficient projection formula. For spheres and cylinders, symmetry often provides especially simple area elements. In every case, the goal is the same: express $dS$ correctly, express the scalar function on the surface, and integrate over a two-dimensional domain that covers the surface exactly once.
