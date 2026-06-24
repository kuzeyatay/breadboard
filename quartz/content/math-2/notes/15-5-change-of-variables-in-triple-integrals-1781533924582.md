---
title: "15.6 Change of Variables in Triple Integrals"
date: "2026-06-15T14:32:04.582Z"
source: "user-note"
knowledge_type: "user-note"
---

# 15.6 Change of Variables in Triple Integrals

A triple integral adds up a quantity throughout a three-dimensional solid. If the quantity being added is $1$, the triple integral gives volume. If the quantity is a density function $\rho(x,y,z)$, the triple integral gives mass. If the quantity is something like $x^2+y^2$, the integral may represent a moment of inertia. The basic idea is always the same: divide the solid into very small volume pieces, evaluate the quantity on each small piece, multiply by the small volume, and add everything.

The difficulty is that the shape of the solid may not match Cartesian coordinates. Cartesian coordinates work well when the boundaries are naturally described by equations such as $x=a$, $y=b$, $z=c$, or when one variable can be written cleanly between two functions of the other variables. But many three-dimensional regions in this course are built from cylinders, spheres, cones, or rotationally symmetric surfaces. In such cases, Cartesian bounds often become complicated, while cylindrical or spherical bounds become simple. Change of variables is the method that allows us to rewrite the whole triple integral in coordinates that match the geometry of the solid.

The word “whole” is important. A change of variables does not mean only replacing $x$, $y$, and $z$ inside the integrand. It also changes the region of integration and the small volume element. In Cartesian coordinates, the volume element is written

$$
dV=dx\,dy\,dz.
$$

This represents a tiny rectangular box whose side lengths are approximately $dx$, $dy$, and $dz$. If we describe the same physical space using new coordinates, the small coordinate box in the new variables is usually not a rectangular Cartesian box after it is mapped into $xyz$-space. It may be stretched, tilted, or curved. Therefore $dx\,dy\,dz$ cannot simply be replaced by $du\,dv\,dw$. A correction factor is needed.

![pasted 1781534948353](/math-2/assets/pasted-1781534948353.png)

Suppose a coordinate transformation is given by

$$
x=x(u,v,w),\qquad y=y(u,v,w),\qquad z=z(u,v,w).
$$

The variables $u$, $v$, and $w$ are the new coordinates. The variables $x$, $y$, and $z$ are the original Cartesian coordinates. A point $(u,v,w)$ in the new coordinate space is sent to the point $(x,y,z)$ in ordinary three-dimensional space. If $S$ is the region in the new coordinates and $D$ is the corresponding solid in Cartesian coordinates, then the transformation maps $S$ onto $D$.

The original integrand must also be rewritten. If the original function is $f(x,y,z)$, then after the substitution it becomes

$$
f(x(u,v,w),y(u,v,w),z(u,v,w)).
$$

This is not a new physical quantity. It is the same quantity, but expressed using the new coordinate labels.

The volume correction factor is the absolute value of a determinant. The matrix used for this determinant is called the Jacobian matrix of the transformation:

$$
\frac{\partial(x,y,z)}{\partial(u,v,w)}
=
\begin{pmatrix}
\dfrac{\partial x}{\partial u} & \dfrac{\partial x}{\partial v} & \dfrac{\partial x}{\partial w}\\[6pt]
\dfrac{\partial y}{\partial u} & \dfrac{\partial y}{\partial v} & \dfrac{\partial y}{\partial w}\\[6pt]
\dfrac{\partial z}{\partial u} & \dfrac{\partial z}{\partial v} & \dfrac{\partial z}{\partial w}
\end{pmatrix}.
$$

Each entry tells how one Cartesian coordinate changes when one new coordinate changes and the other new coordinates are held fixed. The determinant of this matrix is written

$$
J=\det\left(\frac{\partial(x,y,z)}{\partial(u,v,w)}\right).
$$

Geometrically, $|J|$ is the local volume-scaling factor. A very small box in $uvw$-space is transformed into a very small parallelepiped in $xyz$-space. The determinant gives the signed volume-scaling factor of that parallelepiped. The absolute value is used because physical volume is positive, even if the coordinate transformation reverses orientation.

The change-of-variables formula for triple integrals is therefore

$$
\iiint_D f(x,y,z)\,dx\,dy\,dz
=
\iiint_S
f(x(u,v,w),y(u,v,w),z(u,v,w))
\left|
\det\left(\frac{\partial(x,y,z)}{\partial(u,v,w)}\right)
\right|
\,du\,dv\,dw.
$$

Here $D$ is the original solid in $xyz$-space, $S$ is the same solid described in the new variables, $f(x,y,z)$ is the original integrand, and the determinant factor converts the new coordinate volume $du\,dv\,dw$ into actual Cartesian volume. The transformation should not count the same part of the solid twice. In practice, this means choosing coordinate ranges carefully, especially for angles.

The most common mistake is to transform the integrand and the bounds but forget the Jacobian factor. In cylindrical coordinates this lost factor is usually $r$. In spherical coordinates it is usually $R^2\sin\phi$. These factors are not optional decorations; they are part of the volume element.

![pasted 1781534786810](/math-2/assets/pasted-1781534786810.png)

Cylindrical coordinates are useful when the problem has circular symmetry around the $z$-axis. A point is described by $(r,\theta,z)$. The coordinate $r$ is the distance from the $z$-axis, $\theta$ is the angle in the $xy$-plane measured from the positive $x$-axis, and $z$ is the usual vertical coordinate. The transformation to Cartesian coordinates is

$$
x=r\cos\theta,\qquad y=r\sin\theta,\qquad z=z.
$$

The coordinate $r$ satisfies $r\ge 0$, because it is a distance. This is a common source of mistakes. Negative values of $r$ are not normally used in this course’s cylindrical-coordinate setup. If a region seems to require negative $r$, the angle range probably needs to be adjusted instead.

The Jacobian determinant for cylindrical coordinates is

$$
\det\left(\frac{\partial(x,y,z)}{\partial(r,\theta,z)}\right)
=
\det
\begin{pmatrix}
\cos\theta & -r\sin\theta & 0\\
\sin\theta & r\cos\theta & 0\\
0&0&1
\end{pmatrix}
=r.
$$

Thus the cylindrical volume element is

$$
dV=r\,dr\,d\theta\,dz.
$$

The factor $r$ has a direct geometric meaning. A small angular change $d\theta$ sweeps out a longer arc when the point is farther from the $z$-axis. At radius $r$, the angular side length is approximately $r\,d\theta$, not just $d\theta$. Multiplying the three small side lengths $dr$, $r\,d\theta$, and $dz$ gives $r\,dr\,d\theta\,dz$.

![pasted 1781534809675](/math-2/assets/pasted-1781534809675.png)

Cylindrical coordinates are especially useful when the solid is bounded by cylinders such as

$$
x^2+y^2=a^2,
$$

because this equation becomes

$$
r=a.
$$

They are also useful when the integrand contains $x^2+y^2$, because

$$
x^2+y^2=r^2.
$$

This does not mean every sphere should automatically be treated with spherical coordinates. If the integrand is built from $x^2+y^2$, cylindrical coordinates may be better even when the outer boundary is spherical.

Consider the solid in the first octant bounded by the cylinders

$$
x^2+y^2=1,\qquad x^2+y^2=4,
$$

the planes

$$
z=0,\qquad z=1,
$$

and the vertical planes

$$
x=0,\qquad x=y.
$$

![pasted 1781534833538](/math-2/assets/pasted-1781534833538.png)

The cylinders become $r=1$ and $r=2$. In the first octant, the plane $x=y$ corresponds to $\theta=\pi/4$, while the plane $x=0$ corresponds to $\theta=\pi/2$. The vertical bounds remain $0\le z\le 1$. Therefore, if we want to evaluate

$$
\iiint_D (x^2+y^2)\,dV,
$$

then the integrand becomes $r^2$, and the volume element becomes $r\,dr\,d\theta\,dz$. Hence

$$
\iiint_D (x^2+y^2)\,dV
=
\int_0^1\int_{\pi/4}^{\pi/2}\int_1^2 r^2\cdot r\,dr\,d\theta\,dz.
$$

The product $r^2\cdot r$ should be read carefully. The factor $r^2$ comes from the original integrand $x^2+y^2$. The extra factor $r$ comes from the volume element. Evaluating gives

$$
\int_0^1\int_{\pi/4}^{\pi/2}\int_1^2 r^3\,dr\,d\theta\,dz
=
1\cdot \frac{\pi}{4}\cdot \frac{2^4-1^4}{4}
=
\frac{15\pi}{16}.
$$

A more exam-style cylindrical setup occurs when a sphere and a cylinder appear together. Suppose

$$
D=\{(x,y,z)\in\mathbb R^3:x^2+y^2+z^2\le 4,\ x^2+y^2\le 2x,\ y\ge 0\}.
$$

The sphere gives

$$
z^2\le 4-r^2,
$$

so

$$
-\sqrt{4-r^2}\le z\le \sqrt{4-r^2}.
$$

The cylinder-like inequality becomes

$$
r^2\le 2r\cos\theta.
$$

Since $r\ge 0$, this gives

$$
0\le r\le 2\cos\theta,
$$

where $\cos\theta\ge 0$. The condition $y\ge 0$ gives $\sin\theta\ge 0$. Together, these angle restrictions give

$$
0\le \theta\le \frac{\pi}{2}.
$$

If the integrand is

$$
\frac{xy}{x^2+y^2},
$$

then cylindrical coordinates give

$$
\frac{xy}{x^2+y^2}
=
\frac{(r\cos\theta)(r\sin\theta)}{r^2}
=
\cos\theta\sin\theta.
$$

The transformed integral is therefore

$$
\iiint_D \frac{xy}{x^2+y^2}\,dV
=
\int_0^{\pi/2}
\int_0^{2\cos\theta}
\int_{-\sqrt{4-r^2}}^{\sqrt{4-r^2}}
\cos\theta\sin\theta\, r
\,dz\,dr\,d\theta.
$$

Again, the final factor $r$ is the Jacobian factor. Without it, the integral would not represent the same three-dimensional quantity.

![pasted 1781534870113](/math-2/assets/pasted-1781534870113.png)

Spherical coordinates are useful when the region or integrand depends naturally on distance from the origin. A point is described by $(R,\phi,\theta)$. The coordinate $R$ is the distance from the origin, $\phi$ is the angle measured downward from the positive $z$-axis, and $\theta$ is the angle in the $xy$-plane measured from the positive $x$-axis.

The transformation to Cartesian coordinates is

$$
x=R\sin\phi\cos\theta,\qquad
y=R\sin\phi\sin\theta,\qquad
z=R\cos\phi.
$$

The standard ranges are

$$
R\ge 0,\qquad 0\le \phi\le \pi,\qquad 0\le \theta<2\pi.
$$

The angle $\phi$ is not the angle in the $xy$-plane. It is measured from the positive $z$-axis. Thus $\phi=0$ points along the positive $z$-axis, $\phi=\pi/2$ lies in the $xy$-plane, and $\phi=\pi$ points along the negative $z$-axis. This distinction is essential when setting bounds.

The main identities are

$$
R^2=x^2+y^2+z^2,
$$

$$
r=\sqrt{x^2+y^2}=R\sin\phi,
$$

and

$$
z=R\cos\phi.
$$

These identities explain why spherical coordinates are natural for spheres and cones centered on the $z$-axis. A sphere centered at the origin has equation $R=\text{constant}$. A cone around the $z$-axis often has equation $\phi=\text{constant}$. A vertical half-plane through the $z$-axis has equation $\theta=\text{constant}$.

![pasted 1781534885974](/math-2/assets/pasted-1781534885974.png)

The spherical volume element is

$$
dV=R^2\sin\phi\,dR\,d\phi\,d\theta.
$$

The factor $R^2\sin\phi$ comes from multiplying the three small side lengths of a spherical coordinate box. The radial side length is $dR$. The side length produced by changing $\phi$ is $R\,d\phi$. The side length produced by changing $\theta$ is $R\sin\phi\,d\theta$, because the distance from the $z$-axis is $R\sin\phi$. Multiplying these gives

$$
dR\cdot R\,d\phi\cdot R\sin\phi\,d\theta
=
R^2\sin\phi\,dR\,d\phi\,d\theta.
$$

The same result is obtained by computing the Jacobian determinant:

$$
\det\left(\frac{\partial(x,y,z)}{\partial(R,\phi,\theta)}\right)
=
R^2\sin\phi.
$$

Since $R\ge 0$ and $0\le \phi\le \pi$, the factor $\sin\phi$ is nonnegative on the standard range. Thus the absolute value gives the same expression.

Spherical coordinates are especially useful when the integrand contains

$$
x^2+y^2+z^2,
$$

because this becomes simply

$$
R^2.
$$

They are also useful when the region is a ball, a spherical shell, a hemisphere, or a cone whose vertex is at the origin and whose axis is the $z$-axis.

As an example, consider the region inside the sphere

$$
x^2+y^2+z^2=a^2
$$

and inside the cone

$$
z=\sqrt{x^2+y^2}.
$$

In spherical coordinates, the sphere becomes

$$
R=a.
$$

The cone becomes

$$
R\cos\phi=R\sin\phi.
$$

For $R>0$, this simplifies to

$$
\cos\phi=\sin\phi,
$$

so

$$
\phi=\frac{\pi}{4}.
$$

The part inside the cone around the positive $z$-axis has

$$
0\le \phi\le \frac{\pi}{4}.
$$

The complete rotation around the $z$-axis gives

$$
0\le \theta\le 2\pi,
$$

and the sphere gives

$$
0\le R\le a.
$$

Therefore the volume is

$$
V=
\int_0^{2\pi}\int_0^{\pi/4}\int_0^a
R^2\sin\phi\,dR\,d\phi\,d\theta.
$$

Evaluating this integral gives

$$
V
=
(2\pi)
\left(1-\cos\frac{\pi}{4}\right)
\frac{a^3}{3}
=
\frac{2\pi a^3}{3}
\left(1-\frac{\sqrt2}{2}\right).
$$

The key step is recognizing the geometry: a sphere gives a simple $R$-bound, and a cone gives a simple $\phi$-bound.

A very important exam-style integral is the moment of inertia of a uniform solid ball about the $z$-axis. Let

$$
D=\{(x,y,z)\in\mathbb R^3:x^2+y^2+z^2\le a^2\}.
$$

The required integral is

$$
\iiint_D (x^2+y^2)\,dx\,dy\,dz.
$$

The region is a ball, so spherical coordinates are a natural candidate. In spherical coordinates,

$$
x^2+y^2=R^2\sin^2\phi,
$$

and

$$
dV=R^2\sin\phi\,dR\,d\phi\,d\theta.
$$

The ball is described by

$$
0\le R\le a,\qquad 0\le \phi\le \pi,\qquad 0\le \theta\le 2\pi.
$$

Thus

$$
\iiint_D (x^2+y^2)\,dV
=
\int_0^{2\pi}\int_0^\pi\int_0^a
R^2\sin^2\phi\cdot R^2\sin\phi
\,dR\,d\phi\,d\theta.
$$

So

$$
\iiint_D (x^2+y^2)\,dV
=
\int_0^{2\pi}\int_0^\pi\int_0^a
R^4\sin^3\phi
\,dR\,d\phi\,d\theta.
$$

Now compute each factor:

$$
\int_0^a R^4\,dR=\frac{a^5}{5},
$$

$$
\int_0^\pi \sin^3\phi\,d\phi=\frac{4}{3},
$$

and

$$
\int_0^{2\pi}d\theta=2\pi.
$$

Therefore

$$
\iiint_D (x^2+y^2)\,dV
=
\frac{a^5}{5}\cdot \frac{4}{3}\cdot 2\pi
=
\frac{8\pi a^5}{15}.
$$

This example also shows why the transformed integrand and the Jacobian must be kept separate. The factor $R^2\sin^2\phi$ comes from the quantity being integrated. The factor $R^2\sin\phi$ comes from the volume element.

![pasted 1781534901580](/math-2/assets/pasted-1781534901580.png)

The choice between cylindrical and spherical coordinates deserves careful attention. A sphere suggests spherical coordinates, but this is not always the simplest choice. If the region is inside a sphere but outside a cylinder, cylindrical coordinates may lead to simpler bounds. This is especially true when the integrand contains $x^2+y^2$.

Consider the solid of unit density inside the sphere

$$
x^2+y^2+z^2=4a^2
$$

and outside the cylinder

$$
x^2+y^2=a^2.
$$

Suppose we want the moment of inertia about the $z$-axis. The integrand is

$$
x^2+y^2.
$$

In cylindrical coordinates, this becomes $r^2$, and the volume element is $r\,dr\,d\theta\,dz$. The sphere becomes

$$
r^2+z^2=4a^2,
$$

so

$$
-\sqrt{4a^2-r^2}\le z\le \sqrt{4a^2-r^2}.
$$

The cylinder gives

$$
r=a,
$$

and the sphere gives the outer radial bound $r=2a$. Using symmetry above and below the $xy$-plane, the moment of inertia can be written as

$$
I
=
2\int_0^{2\pi}\int_a^{2a}\int_0^{\sqrt{4a^2-r^2}}
r^2\cdot r
\,dz\,dr\,d\theta.
$$

That is,

$$
I
=
2\int_0^{2\pi}\int_a^{2a}\int_0^{\sqrt{4a^2-r^2}}
r^3
\,dz\,dr\,d\theta.
$$

After integrating with respect to $z$, this becomes

$$
I
=
4\pi\int_a^{2a}r^3\sqrt{4a^2-r^2}\,dr.
$$

Using the substitution

$$
u=4a^2-r^2,
$$

one obtains

$$
I=\frac{44}{5}\sqrt{3}\,\pi a^5.
$$

This example gives the most important rule for choosing coordinates in this section. Use the geometry of the region to get candidate coordinate systems, but use the integrand to decide between them when the choice is unclear. If the integrand involves $x^2+y^2$, cylindrical coordinates are often preferable. If it involves $x^2+y^2+z^2$, spherical coordinates are often preferable.

It is also important to distinguish coordinate transformations for integration from coordinate formulas for vector operations. In this section, the purpose of cylindrical and spherical coordinates is to rewrite triple integrals. The central question is how $dV$ changes. Later, the same coordinate systems can be used for gradients, divergence, curl, and vector fields, but those require different formulas. The volume factors $r$ and $R^2\sin\phi$ belong to integration; they are not the same thing as the scale factors that appear in vector derivative operators.

The practical procedure for a change of variables in a triple integral is therefore as follows. First identify the geometry of the region and choose a coordinate system that matches it. Next rewrite every boundary in the new variables. Then rewrite the integrand. After that, insert the correct Jacobian factor into the volume element. Only once all three parts have been transformed—the region, the integrand, and the volume element—should the integral be evaluated.

The section can be summarized in one central idea: a triple integral measures accumulated quantity over physical volume, and a coordinate change relabels the same physical volume in a more convenient way. The Jacobian determinant is the bridge between the labels and the actual volume. Cylindrical coordinates are built for axial symmetry and expressions involving $x^2+y^2$. Spherical coordinates are built for radial symmetry and expressions involving $x^2+y^2+z^2$. The art of the method is not only knowing the formulas, but choosing the coordinate system that makes the solid and the integrand work together.
