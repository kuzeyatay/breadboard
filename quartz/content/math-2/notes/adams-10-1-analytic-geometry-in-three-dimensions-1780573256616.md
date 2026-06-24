---
title: "10.1 Analytic Geometry in Three Dimensions"
date: "2026-06-04T11:40:56.616Z"
source: "user-note"
knowledge_type: "user-note"
---

# Adams 10.1 — Analytic Geometry in Three Dimensions

The first problem in multivariable calculus is not differentiation or integration. It is description. In one-variable calculus, the input of a function is usually one real number, so the geometry is the geometry of the real line. A point is just a number $x$, intervals describe domains, and graphs live in the plane. In Math 2, the objects are spatial. A temperature field may depend on position $(x,y,z)$, a particle may move through three-dimensional space, an electric field may assign a vector to every point in a region, and an integral may be taken over a surface or a solid. Before any of these ideas can be treated carefully, we need a language for locating points, measuring distances, describing surfaces, and deciding whether points lie inside, outside, or on the boundary of a region.

This is the purpose of analytic geometry in three dimensions. The word analytic means that geometry is described by equations and inequalities. Instead of only drawing a sphere, a plane, or a cylinder, we represent it by algebraic conditions on coordinates. This is why Adams 10.1 appears at the beginning of the course: it supplies the coordinate language needed for quadric surfaces, cylindrical and spherical coordinates, vector functions, parametrized curves, functions of several variables, multiple integrals, and vector fields.

![pasted 1780573498565](/math-2/assets/pasted-1780573498565.png)

Three-dimensional Cartesian space is built from three mutually perpendicular coordinate axes. These are called the $x$-axis, the $y$-axis, and the $z$-axis. The point where all three axes meet is called the origin and is denoted by $O$. A point $P$ in space is described by an ordered triple

$$
P=(x,y,z).
$$

Here $x$, $y$, and $z$ are real numbers. The number $x$ tells how far the point is displaced in the $x$-direction, the number $y$ tells how far it is displaced in the $y$-direction, and the number $z$ tells how far it is displaced in the $z$-direction. The order matters: $(1,2,3)$, $(2,1,3)$, and $(3,2,1)$ are generally different points.

The coordinate axes are oriented by the right-hand rule. This means that the positive $x$-, $y$-, and $z$-directions are arranged like the thumb, index finger, and middle finger of the right hand when placed in the standard orientation. In vector notation, the standard unit vectors are denoted by

$$
\mathbf i,\qquad \mathbf j,\qquad \mathbf k.
$$

The vector $\mathbf i$ points in the positive $x$-direction, $\mathbf j$ points in the positive $y$-direction, and $\mathbf k$ points in the positive $z$-direction. A unit vector is a vector whose length is $1$. The right-handed orientation is summarized by

$$
\mathbf i\times \mathbf j=\mathbf k.
$$

Here $\times$ denotes the cross product. The cross product itself is treated more fully later, but at this stage the formula is mainly an orientation convention. It fixes the positive $z$-direction once the positive $x$- and $y$-directions have been chosen. This matters later because signs in cross products, normal directions, surface orientation, and flux depend on orientation.

A point can also be represented by its position vector. The position vector of $P=(x,y,z)$ is

$$
\mathbf r=x\mathbf i+y\mathbf j+z\mathbf k.
$$

Here $\mathbf r$ is the vector from the origin $O$ to the point $P$, and $x$, $y$, and $z$ are its Cartesian components. A point and a position vector carry the same coordinate data, but they are conceptually different. A point is a location. A position vector is an arrow from the origin to that location. This distinction becomes important later when a moving particle is described by a time-dependent position vector $\mathbf r(t)$.

![pasted 1780573535812](/math-2/assets/pasted-1780573535812.png)

The distance from the origin to $P=(x,y,z)$ follows from the Pythagorean theorem. First project $P$ onto the $xy$-plane. The projection is the point

$$
Q=(x,y,0).
$$

The distance from $O=(0,0,0)$ to $Q=(x,y,0)$ is

$$
\sqrt{x^2+y^2}.
$$

This is the ordinary two-dimensional distance formula in the $xy$-plane. The point $P$ is then obtained from $Q$ by moving vertically by $z$. Therefore the distance from $O$ to $P$, denoted $|\mathbf r|$, is

$$
|\mathbf r|=\sqrt{x^2+y^2+z^2}.
$$

Here $|\mathbf r|$ means the length of the position vector $\mathbf r$. Geometrically, this formula says that the squared distance in space is the sum of the squared displacements in the three mutually perpendicular coordinate directions.

The same idea gives the distance between any two points. If

$$
P_1=(x_1,y_1,z_1)
\quad\text{and}\quad
P_2=(x_2,y_2,z_2),
$$

then the coordinate changes from $P_1$ to $P_2$ are

$$
x_2-x_1,\qquad y_2-y_1,\qquad z_2-z_1.
$$

The Euclidean distance between $P_1$ and $P_2$ is

$$
d(P_1,P_2)=\sqrt{(x_2-x_1)^2+(y_2-y_1)^2+(z_2-z_1)^2}.
$$

Here $d(P_1,P_2)$ denotes the straight-line distance from $P_1$ to $P_2$. The word Euclidean means that the distance is measured using ordinary straight-line geometry, so the Pythagorean theorem applies.

A useful way to understand the formula is that it turns a geometric question into an algebraic calculation. For example, suppose a triangle has vertices

$$
A=(1,-1,2),\qquad B=(3,3,8),\qquad C=(2,0,1).
$$

The squared side lengths are easier to compare than the side lengths themselves. We compute

$$
|AC|^2=(2-1)^2+(0-(-1))^2+(1-2)^2=1+1+1=3,
$$

$$
|AB|^2=(3-1)^2+(3-(-1))^2+(8-2)^2=4+16+36=56,
$$

and

$$
|BC|^2=(2-3)^2+(0-3)^2+(1-8)^2=1+9+49=59.
$$

Since

$$
|AC|^2+|AB|^2=3+56=59=|BC|^2,
$$

the triangle satisfies the Pythagorean relation with $BC$ as the hypotenuse. Therefore the angle at $A$ is a right angle. The important method is that right-angle questions can be answered by comparing squared distances.

![pasted 1780573580188](/math-2/assets/pasted-1780573580188.png)

The coordinate axes determine three coordinate planes. The $xy$-plane consists of all points whose $z$-coordinate is zero:

$$
z=0.
$$

The $xz$-plane consists of all points whose $y$-coordinate is zero:

$$
y=0.
$$

The $yz$-plane consists of all points whose $x$-coordinate is zero:

$$
x=0.
$$

These three planes divide three-dimensional space into eight regions called octants. The first octant is the region where all three coordinates are nonnegative:

$$
x\geq 0,\qquad y\geq 0,\qquad z\geq 0.
$$

This is the three-dimensional analogue of the first quadrant in the $xy$-plane. The reason there are eight octants is that each of the three coordinates may be positive or negative, giving $2^3=8$ possible sign combinations.

Equations in $x$, $y$, and $z$ describe sets of points in space. A single equation in three variables often describes a surface, although special cases may describe a curve, a point, or no points at all. For instance,

$$
z=0
$$

describes the $xy$-plane, and

$$
z=-2
$$

describes a horizontal plane two units below the $xy$-plane.

The equation

$$
x+y+z=1
$$

describes an oblique plane. It is called oblique because it is not parallel to any coordinate plane. It intersects the coordinate axes at

$$
(1,0,0),\qquad (0,1,0),\qquad (0,0,1),
$$

because setting two variables equal to zero determines the intercept on the remaining axis. The related equation

$$
x+y+z=0
$$

describes a parallel plane passing through the origin. Both equations have the same left-hand side, so they have the same orientation; changing the right-hand side shifts the plane.

A light bridge to the next geometry section is useful here. A plane is often written in the form

$$
ax+by+cz=d.
$$

Here $a$, $b$, $c$, and $d$ are constants, while $x$, $y$, and $z$ are the coordinates of a variable point on the plane. Later, the vector

$$
a\mathbf i+b\mathbf j+c\mathbf k
$$

will be interpreted as a normal vector to the plane, meaning a vector perpendicular to the plane. This normal-vector interpretation belongs more naturally to the later treatment of planes and vectors, but it explains why the coefficients $a$, $b$, and $c$ matter geometrically.

A common source of confusion is that the same equation can describe different kinds of objects in different ambient spaces. In $\mathbb R^2$, the equation

$$
x=y
$$

describes a line in the plane. In $\mathbb R^3$, the same equation describes a plane, because $z$ is unrestricted. Every point satisfying the equation has the form

$$
(x,x,z),
$$

where both $x$ and $z$ may vary freely. Two independent quantities are free, so the set is two-dimensional, not one-dimensional.

![pasted 1780573640325](/math-2/assets/pasted-1780573640325.png)

![pasted 1780573679550](/math-2/assets/pasted-1780573679550.png)

![pasted 1780573990792](/math-2/assets/pasted-1780573990792.png)
The equation

$$
x^2+y^2=4
$$

describes a circular cylinder of radius $2$ whose axis is the $z$-axis. The reason is that the equation contains $x$ and $y$, but not $z$. In every horizontal plane $z=\text{constant}$, the cross-section is the circle

$$
x^2+y^2=4.
$$

Because the same circle is repeated for every value of $z$, the surface extends parallel to the $z$-axis.

This example also shows the difference between a surface and a solid. The equation

$$
x^2+y^2=4
$$

describes only the cylindrical surface. The inequality

$$
x^2+y^2\leq 4
$$

describes the solid cylinder, including all points whose distance from the $z$-axis is at most $2$. The strict inequality

$$
x^2+y^2<4
$$

describes the inside of the cylinder without the boundary surface.

The equation

$$
z=x^2
$$

describes a parabolic cylinder. In the $xz$-plane, where $y=0$, this is the parabola $z=x^2$. Since $y$ does not appear in the equation, the same parabola is repeated for every value of $y$. The result is a trough-shaped surface extending parallel to the $y$-axis.

The equation

$$
x^2+y^2+z^2=25
$$

describes a sphere of radius $5$ centered at the origin. This follows immediately from the distance formula, because the left-hand side is the square of the distance from $(0,0,0)$ to $(x,y,z)$. The equation says that this distance is exactly $5$.

More generally, the sphere with centre

$$
C=(a,b,c)
$$

and radius $R>0$ has equation

$$
(x-a)^2+(y-b)^2+(z-c)^2=R^2.
$$

Here $a$, $b$, and $c$ are the coordinates of the centre, $R$ is the radius, and $(x,y,z)$ is a variable point on the sphere. The equation says that the distance from $(x,y,z)$ to $(a,b,c)$ is $R$.

A useful recognition rule is that a missing variable usually means extension parallel to that variable’s axis. For example,

$$
y^2+(z-1)^2=4
$$

does not contain $x$. Therefore it describes a circular cylinder parallel to the $x$-axis. In the $yz$-plane, the equation is a circle of radius $2$ centered at $(y,z)=(0,1)$, and this circle is repeated as $x$ varies.

Equations involving sums of squares may also degenerate. The equation

$$
y^2+(z-1)^2=0
$$

forces

$$
y=0,\qquad z=1,
$$

because a sum of squares is zero only when every squared term is zero. The variable $x$ remains free, so the set is the line

$$
(x,0,1),
$$

where $x$ may be any real number. Similarly,

$$
x^2+y^2+z^2=0
$$

describes only the single point

$$
(0,0,0),
$$

whereas

$$
x^2+y^2+z^2=-1
$$

describes no real points, because the left-hand side cannot be negative.

Inequalities describe regions. The inequality

$$
z>0
$$

describes the half-space above the $xy$-plane, excluding the boundary plane itself. A half-space is one side of a plane. The inequality

$$
z\geq 0
$$

describes the same side together with the boundary plane $z=0$. The difference between $>$ and $\geq$ is not cosmetic: it determines whether boundary points are included.

The inequality

$$
x^2+y^2+z^2\leq 25
$$

describes the solid ball of radius $5$ centered at the origin. A sphere is only the boundary surface; a ball is the filled-in solid. Thus

$$
x^2+y^2+z^2=25
$$

is the sphere, while

$$
x^2+y^2+z^2\leq 25
$$

is the ball including its boundary.

A practical way to solve recognition problems is to ask three questions. First, which variables appear? A missing variable often means the set extends parallel to that coordinate direction. Second, are the conditions equations or inequalities? Equations usually describe boundaries or surfaces, while inequalities usually describe regions. Third, are the inequalities strict or non-strict? Strict inequalities exclude the boundary; non-strict inequalities include it.

![pasted 1780574032284](/math-2/assets/pasted-1780574032284.png)

A system of two equations in three variables usually describes the intersection of two surfaces. For example,

$$
x+y+z=1,
\qquad
y-2x=0
$$

describes the intersection of two planes. The second equation gives

$$
y=2x.
$$

Substituting this into the first equation gives

$$
x+2x+z=1,
$$

so

$$
z=1-3x.
$$

Thus the common points have the form

$$
(x,2x,1-3x).
$$

Here $x$ is a free parameter. When $x=0$, the point is

$$
(0,0,1).
$$

When $x=\frac13$, the point is

$$
\left(\frac13,\frac23,0\right).
$$

These two points lie on the line of intersection of the planes.

Another important example is

$$
x^2+y^2+z^2=1,
\qquad
x+y=1.
$$

The first equation describes the unit sphere centered at the origin. The second equation describes a vertical plane passing through the points

$$
(1,0,0)
\quad\text{and}\quad
(0,1,0).
$$

Their intersection is a circle. The segment from $(1,0,0)$ to $(0,1,0)$ is a diameter of this circle, so the centre is the midpoint

$$
\left(\frac12,\frac12,0\right).
$$

The length of the diameter is

$$
\sqrt{(0-1)^2+(1-0)^2+(0-0)^2}=\sqrt{2}.
$$

Therefore the radius is half of this length:

$$
\frac{\sqrt2}{2}.
$$

This example illustrates the basic geometric meaning of a system of equations: each equation imposes one condition, and the solution set consists of points satisfying all conditions simultaneously.

The same coordinate language extends beyond three dimensions. For a positive integer $n$, Euclidean $n$-space is denoted by

$$
\mathbb R^n.
$$

A point in $\mathbb R^n$ is an ordered $n$-tuple

$$
(x_1,x_2,\ldots,x_n).
$$

Here $x_i$ denotes the $i$-th coordinate. The notation changes from $x,y,z$ to $x_1,x_2,\ldots,x_n$ because in higher dimensions there are not enough traditional coordinate letters. Although $\mathbb R^4$ and higher-dimensional spaces are difficult to visualize directly, the algebraic structure remains clear: points are ordered lists of real numbers.

The Euclidean distance between

$$
P=(x_1,x_2,\ldots,x_n)
\quad\text{and}\quad
Q=(y_1,y_2,\ldots,y_n)
$$

is

$$
d(P,Q)=\sqrt{(y_1-x_1)^2+(y_2-x_2)^2+\cdots+(y_n-x_n)^2}.
$$

Here $d(P,Q)$ is the straight-line distance between $P$ and $Q$, generalized algebraically to $n$ coordinates.

In $\mathbb R^n$, an object analogous to a plane is called a hyperplane. A hyperplane has one dimension less than the surrounding space. For example,

$$
x_n=0
$$

is a hyperplane in $\mathbb R^n$. In $\mathbb R^3$, this becomes $z=0$, which is a plane. In $\mathbb R^2$, it becomes $y=0$, which is a line.

![pasted 1780574070824](/math-2/assets/pasted-1780574070824.png)

The final part of this section introduces the language needed to describe domains precisely. This language is essential later for limits, continuity, partial derivatives, multiple integrals, and boundary-value questions. The key idea is to look at small neighbourhoods around points.

Let $P$ be a point in $\mathbb R^n$, and let $r>0$. The open ball of radius $r$ centered at $P$ is

$$
B_r(P)=\{Q\in\mathbb R^n:d(P,Q)<r\}.
$$

Here $B_r(P)$ denotes the set of all points $Q$ whose distance from $P$ is less than $r$. In $\mathbb R$, this is an open interval. In $\mathbb R^2$, it is an open disk. In $\mathbb R^3$, it is an open ball. Such an open ball is also called a neighbourhood of $P$.

A set $S\subseteq\mathbb R^n$ is called open if every point of $S$ has a neighbourhood contained completely inside $S$. This means that if $P\in S$, then there exists some radius $r>0$ such that

$$
B_r(P)\subseteq S.
$$

Intuitively, no point of an open set is forced to sit on the edge. From every point in the set, one can move a sufficiently small distance in any direction and still remain in the set.

For example, the disk

$$
x^2+y^2<1
$$

is open in $\mathbb R^2$. Every point inside the unit circle has some small circular neighbourhood that still lies inside the circle.

The complement of a set $S\subseteq\mathbb R^n$, denoted by

$$
S^c,
$$

is the set of all points in $\mathbb R^n$ that do not belong to $S$. A set $S$ is called closed if its complement $S^c$ is open. Typical sets described by non-strict inequalities, such as $\leq$ or $\geq$, are closed because they include their boundary. For example,

$$
x^2+y^2\leq 1
$$

is the closed unit disk.

The whole space $\mathbb R^n$ is open, because every neighbourhood of every point in $\mathbb R^n$ is still contained in $\mathbb R^n$. The empty set is also open, because there is no point in the empty set that fails the open-set condition. Since $\mathbb R^n$ and the empty set are complements of each other, both are also closed. In $\mathbb R^n$, these are the only sets that are both open and closed.

A point $P$ is called a boundary point of a set $S$ if every neighbourhood of $P$ contains at least one point of $S$ and at least one point outside $S$. The boundary of $S$ is denoted by

$$
\operatorname{bdry}(S).
$$

For the closed unit disk

$$
S=\{(x,y):x^2+y^2\leq 1\},
$$

the boundary is the unit circle

$$
x^2+y^2=1.
$$

A closed set contains all of its boundary points. An open set contains none of its boundary points.

A point $P$ is called an interior point of $S$ if it belongs to $S$ but is not a boundary point. Equivalently, $P$ is an interior point if some neighbourhood of $P$ is contained completely in $S$. The interior of $S$, denoted

$$
\operatorname{int}(S),
$$

is the set of all interior points of $S$.

A point $P$ is called an exterior point of $S$ if it belongs to the complement $S^c$ but is not a boundary point. Equivalently, $P$ is exterior if some neighbourhood of $P$ lies completely outside $S$. The exterior of $S$, denoted

$$
\operatorname{ext}(S),
$$

is the set of all exterior points of $S$.

For the closed unit disk

$$
S=\{(x,y):x^2+y^2\leq 1\},
$$

the interior is

$$
\operatorname{int}(S)=\{(x,y):x^2+y^2<1\},
$$

the boundary is

$$
\operatorname{bdry}(S)=\{(x,y):x^2+y^2=1\},
$$

and the exterior is

$$
\operatorname{ext}(S)=\{(x,y):x^2+y^2>1\}.
$$

Both $\operatorname{int}(S)$ and $\operatorname{ext}(S)$ are open sets. A set $S$ is open exactly when

$$
\operatorname{int}(S)=S,
$$

and it is closed exactly when

$$
\operatorname{ext}(S)=S^c.
$$

These criteria express the same idea in terms of boundary behaviour: an open set contains only interior points, while a closed set contains all boundary points.

It is tempting to think that every set must be either open or closed, but this is false. Consider

$$
S=\{(x,y):x^2+y^2<1,\ y\geq x\}.
$$

This set is not open, because it includes points on the line $y=x$, and any small disk around such a point crosses to the side where $y<x$. It is not closed either, because it excludes points on the circle $x^2+y^2=1$, which are boundary points of the disk condition. A set can therefore be open, closed, both, or neither.

A useful warning is that “infinity” is not a point. For example, in $\mathbb R$, the interval

$$
(-\infty,5)
$$

is open. Its only boundary point is $5$. There is no boundary point at $-\infty$, because $-\infty$ is not a real number. No matter how far left a real number lies, a sufficiently small interval around it still remains inside $(-\infty,5)$. This is the neighbourhood-based way to think about openness and boundaries.

The ideas in Adams 10.1 fit together as the geometric foundation of the course. Coordinates locate points. Position vectors connect coordinates to arrows from the origin. The distance formula measures separation. Equations describe surfaces, curves, points, or empty sets. Inequalities describe regions and determine whether boundaries are included. Systems of equations describe intersections. Euclidean $n$-space generalizes the coordinate idea beyond three dimensions. Open sets, closed sets, interiors, exteriors, and boundaries provide the precise language needed for domains. Together, these tools make it possible to move from one-variable calculus to the geometry of curves, surfaces, scalar fields, vector fields, and integrals in space.
