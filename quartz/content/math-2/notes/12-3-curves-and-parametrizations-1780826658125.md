---
title: "12.3 Curves and Parametrizations"
date: "2026-06-07T10:04:18.125Z"
source: "user-note"
knowledge_type: "user-note"
---

# 12.3 Curves and Parametrizations

After describing points, surfaces, and coordinate systems in three-dimensional space, the next problem is to describe one-dimensional objects in that same space. A line segment can be described by equations for a line, and some plane curves can be written as graphs such as $y=f(x)$, but many curves are not naturally graphs of one variable. A curve may bend through space, loop back on itself, close up, or arise as the intersection of two surfaces. The purpose of parametrization is to describe such a curve by letting one variable move through an interval and recording the corresponding point in space.

The basic idea is that a curve can be traced by a moving point. The variable that controls the tracing is called a **parameter**. In applications the parameter is often time, but in this section it does not have to represent time. It may be an angle, a coordinate, an arc length, or simply an auxiliary variable chosen because it makes the equations manageable. A parametrized curve in three-dimensional space is written as

$$
\mathbf r(t)=x(t)\mathbf i+y(t)\mathbf j+z(t)\mathbf k,\qquad a\leq t\leq b.
$$

Here $t$ is the parameter, $a\leq t\leq b$ is the interval of parameter values, $x(t),y(t),z(t)$ are scalar functions giving the coordinates of the point, and $\mathbf i,\mathbf j,\mathbf k$ are the unit vectors in the positive $x$-, $y$-, and $z$-directions. The vector $\mathbf r(t)$ is the **position vector** of the point on the curve at parameter value $t$. The curve itself is the set of points reached as $t$ runs through the interval.

This distinction between the curve and the parametrization is essential. The **curve** is the geometric object, while the **parametrization** is one way of tracing it. The same road can be walked slowly, run quickly, or traversed starting from a different point; similarly, the same geometric curve can have many different parametrizations. Changing the parameter may change the speed and direction of tracing, but it does not necessarily change the set of points.

![pasted 1780829744286](/math-2/assets/pasted-1780829744286.png)

For example, the three vector functions

$$
\mathbf r_1(t)=\sin t\,\mathbf i+\cos t\,\mathbf j,
\qquad -\frac{\pi}{2}\leq t\leq \frac{\pi}{2},
$$

$$
\mathbf r_2(t)=(t-1)\mathbf i+\sqrt{2t-t^2}\,\mathbf j,
\qquad 0\leq t\leq 2,
$$

and

$$
\mathbf r_3(t)=t\sqrt{2-t^2}\,\mathbf i+(1-t^2)\mathbf j,
\qquad -1\leq t\leq 1,
$$

all describe the same curve: the upper half of the unit circle

$$
x^2+y^2=1,\qquad y\geq 0.
$$

To see this, one checks that each formula gives points with $y\geq 0$, begins at $(-1,0)$, ends at $(1,0)$, and satisfies $x^2+y^2=1$. The functions are different because the parameter moves along the semicircle in different ways. This example is the simplest warning that parametrization is not unique.

A curve may be **open** or **closed**. A parametrized curve

$$
\mathbf r(t),\qquad a\leq t\leq b,
$$

is called **closed** if

$$
\mathbf r(a)=\mathbf r(b).
$$

This means that the starting point and ending point are the same. A closed curve is not necessarily simple, because it may cross itself before returning to the starting point. A curve is called **non-self-intersecting** if it does not pass through the same point twice, except possibly for the starting and ending point of a closed curve. A **simple closed curve** is a closed curve that does not otherwise intersect itself. A circle and an ellipse traced once around are simple closed curves.

![pasted 1780829811671](/math-2/assets/pasted-1780829811671.png)

Every parametrization also gives the curve an **orientation**, meaning a direction of traversal. The orientation is the direction in which the point moves as the parameter increases. The same semicircle can be oriented from left to right or from right to left. For instance,

$$
\mathbf r(t)=\cos t\,\mathbf i+\sin t\,\mathbf j,\qquad 0\leq t\leq \pi,
$$

traces the same upper semicircle from $(1,0)$ to $(-1,0)$, opposite to the earlier parametrizations. Orientation matters whenever the direction along the curve matters, but even here it already matters because it tells us which endpoint is first and which endpoint is last.

Parametrization is especially useful when a curve is given indirectly as the intersection of two surfaces. Two surfaces in three-dimensional space usually meet in a one-dimensional set, so their intersection is often a curve. Cartesian equations such as

$$
F(x,y,z)=0,\qquad G(x,y,z)=0
$$

may describe the curve, but they do not tell us how to move along it. A parametrization solves this by expressing $x,y,z$ in terms of one parameter.

A first strategy is to choose one coordinate as the parameter. This works well when the remaining coordinates can be expressed uniquely in terms of it. For example, consider the line of intersection of the two planes

$$
y=2x-4,\qquad z=3x+1
$$

from $(2,0,7)$ to $(3,2,10)$. Suppose we choose

$$
t=y.
$$

Then $y=t$. From $y=2x-4$, we get

$$
t=2x-4,
$$

so

$$
x=\frac{t+4}{2}.
$$

Substituting this into $z=3x+1$ gives

$$
z=3\left(\frac{t+4}{2}\right)+1=\frac{3}{2}t+7.
$$

Since the curve begins at $y=0$ and ends at $y=2$, the parameter interval is $0\leq t\leq 2$. Therefore a parametrization is

$$
\mathbf r(t)=\frac{t+4}{2}\mathbf i+t\mathbf j+\left(\frac{3}{2}t+7\right)\mathbf k,
\qquad 0\leq t\leq 2.
$$

The parameter choice $t=y$ did not come from physics; it was chosen because it made the algebra direct.

A second example shows why not every coordinate is a good parameter for the whole curve. The plane

$$
x+y=1
$$

intersects the paraboloid

$$
z=x^2+y^2
$$

in a parabola. If we choose $t=x$, then

$$
x=t.
$$

The plane equation gives

$$
y=1-x=1-t.
$$

Substituting into the paraboloid gives

$$
z=x^2+y^2=t^2+(1-t)^2=1-2t+2t^2.
$$

Thus the whole parabola can be parametrized as

$$
\mathbf r(t)=t\mathbf i+(1-t)\mathbf j+(1-2t+2t^2)\mathbf k,
\qquad -\infty<t<\infty.
$$

Choosing $t=y$ would also work. But choosing $t=z$ does not give one simple parametrization of the whole parabola, because for most heights $z$ there are two different points on the parabola. This is the key test for whether a coordinate can serve as a convenient parameter: as the chosen parameter changes, it should identify the point on the curve without ambiguity, or else the curve must be split into pieces.

![pasted 1780829836354](/math-2/assets/pasted-1780829836354.png)

When one of the surfaces is a cylinder, there is often a particularly efficient method. Consider the plane

$$
x+2y+4z=4
$$

and the elliptic cylinder

$$
x^2+4y^2=4.
$$

The cylinder equation does not contain $z$, so it describes an elliptic cylinder extending parallel to the $z$-axis. The cross-section in the $xy$-plane is

$$
x^2+4y^2=4,
$$

or

$$
\frac{x^2}{4}+y^2=1.
$$

A standard parametrization of this ellipse is

$$
x=2\cos t,\qquad y=\sin t,\qquad 0\leq t\leq 2\pi.
$$

Now substitute these into the plane equation and solve for $z$:

$$
2\cos t+2\sin t+4z=4.
$$

Therefore

$$
z=1-\frac{\cos t+\sin t}{2}.
$$

So the intersection curve is parametrized by

$$
\mathbf r(t)=2\cos t\,\mathbf i+\sin t\,\mathbf j+
\left(1-\frac{\cos t+\sin t}{2}\right)\mathbf k,
\qquad 0\leq t\leq 2\pi.
$$

This example illustrates the general procedure: first parametrize the simpler surface, then use the other surface equation to determine the remaining coordinate.

Sometimes the equations do not immediately contain a convenient cylinder or coordinate choice. Then one can combine the equations to eliminate a variable. For example, suppose the curve is described by

$$
x^2+y+z=2,\qquad xy+z=1.
$$

Subtracting the second equation from the first eliminates $z$:

$$
x^2+y-xy=1.
$$

If we choose $x=t$, this becomes

$$
t^2+y(1-t)=1.
$$

For $t\neq 1$, we obtain

$$
y=\frac{1-t^2}{1-t}=1+t.
$$

Then the equation $xy+z=1$ gives

$$
z=1-xy=1-t(1+t)=1-t-t^2.
$$

Thus one parametrized component is

$$
\mathbf r(t)=t\mathbf i+(1+t)\mathbf j+(1-t-t^2)\mathbf k.
$$

The important algebraic warning is that dividing by $1-t$ can hide the case $t=1$. Whenever a derivation divides by an expression that might be zero, that case must be checked separately. Parametrization is not just substitution; it is a way of describing the entire intended curve, so lost branches or missing endpoints must be considered.

Once a curve is parametrized, its derivative gives the tangent direction. If

$$
\mathbf r(t)=x(t)\mathbf i+y(t)\mathbf j+z(t)\mathbf k,
$$

then

$$
\mathbf r'(t)=x'(t)\mathbf i+y'(t)\mathbf j+z'(t)\mathbf k.
$$

Here $x'(t),y'(t),z'(t)$ are the ordinary derivatives of the coordinate functions. When $t$ represents time, $\mathbf r'(t)$ is the velocity vector. In this section, even when $t$ is not time, $\mathbf r'(t)$ still points along the direction in which the curve is being traced. Therefore, a tangent line at $t=t_0$ can be written as

$$
\mathbf R(\lambda)=\mathbf r(t_0)+\lambda \mathbf r'(t_0).
$$

Here $\lambda$ is a new real parameter for the tangent line, $\mathbf r(t_0)$ is the point of tangency, and $\mathbf r'(t_0)$ is the direction vector of the tangent line. This formula is valid when

$$
\mathbf r'(t_0)\neq \mathbf 0.
$$

If $\mathbf r'(t_0)=\mathbf 0$, the parametrization momentarily stops, and the tangent direction may need separate analysis.

A tangent vector gives both direction and size. For many geometric purposes, however, only the direction matters. Therefore we often divide the tangent vector by its own length. If

$$
\mathbf r'(t)\neq \mathbf 0,
$$

the **unit tangent vector** is defined by

$$
\mathbf T(t)=\frac{\mathbf r'(t)}{|\mathbf r'(t)|}.
$$

Here $\mathbf T(t)$ is a vector of length $1$, pointing in the direction in which the curve is traced at parameter value $t$. The denominator $|\mathbf r'(t)|$ is the speed with respect to the parameter $t$. Thus $\mathbf r'(t)$ tells us both direction and speed, while $\mathbf T(t)$ keeps only the direction. This distinction is important: two different parametrizations of the same curve may have different speeds, but if they trace the curve in the same direction, their unit tangent vectors point along the same geometric tangent direction.

The unit tangent vector describes where the curve is pointing. To describe how the curve is turning, we look at how $\mathbf T$ changes. If the unit tangent changes direction, then its derivative points toward the side into which the curve is bending. When this derivative is nonzero, the **unit normal vector** is defined by normalizing that change:

$$
\mathbf N(t)=\frac{\mathbf T'(t)}{|\mathbf T'(t)|},
\qquad \mathbf T'(t)\neq \mathbf 0.
$$

Here $\mathbf N(t)$ has length $1$ and points in the direction in which the tangent direction is turning. The unit normal is perpendicular to the unit tangent. The reason is that $\mathbf T(t)$ always has length $1$, so

$$
\mathbf T(t)\cdot \mathbf T(t)=1.
$$

Differentiating both sides gives

$$
2\mathbf T(t)\cdot \mathbf T'(t)=0,
$$

so

$$
\mathbf T(t)\cdot \mathbf T'(t)=0.
$$

Therefore $\mathbf T'(t)$, and hence $\mathbf N(t)$, is perpendicular to $\mathbf T(t)$. If $\mathbf T'(t)=\mathbf 0$, the tangent direction is not changing at that point, so this unit normal is not defined there. For example, a straight line has a constant unit tangent and therefore no principal unit normal.

This leads to the idea of smoothness. A parametrized curve is usually assumed to have a continuous derivative, so the tangent direction changes without sudden jumps. The vector

$$
\mathbf v(t)=\frac{d\mathbf r}{dt}
$$

is called the **velocity vector** by analogy with motion, and its length

$$
v(t)=|\mathbf v(t)|
$$

is called the **speed**. Here $v(t)$ without boldface is a scalar, while $\mathbf v(t)$ is a vector. A curve can fail to be smooth at a point where $\mathbf v(t)=\mathbf 0$, even if all coordinate functions are differentiable. Geometrically, this means the parametrization stops or forms a cusp-like behaviour, so the tangent direction may not be well-defined in the usual way.

![pasted 1780829856757](/math-2/assets/pasted-1780829856757.png)

The next problem is to measure the length of a curve. For a straight line segment, length is ordinary distance. For a curved path, the idea is to approximate the curve by many short straight chords. Suppose

$$
\mathbf r(t),\qquad a\leq t\leq b,
$$

is a bounded continuous curve. Divide the interval $[a,b]$ into smaller intervals

$$
a=t_0<t_1<t_2<\cdots<t_n=b.
$$

The corresponding points on the curve are

$$
\mathbf r(t_0),\mathbf r(t_1),\ldots,\mathbf r(t_n).
$$

The chord from $\mathbf r(t_{i-1})$ to $\mathbf r(t_i)$ has length

$$
|\mathbf r(t_i)-\mathbf r(t_{i-1})|.
$$

Adding all these chord lengths gives a polygonal approximation to the curve length:

$$
s_n=\sum_{i=1}^n |\mathbf r(t_i)-\mathbf r(t_{i-1})|.
$$

As the subdivision becomes finer, this polygonal length approaches the curve length, provided the curve is well behaved enough. If $\mathbf r(t)$ has a continuous derivative, the resulting arc length is

$$
s=\int_a^b \left|\frac{d\mathbf r}{dt}\right|\,dt.
$$

In this formula, $s$ is the length of the curve from $t=a$ to $t=b$, $\frac{d\mathbf r}{dt}$ is the derivative of the position vector, $\left|\frac{d\mathbf r}{dt}\right|$ is its length, and $dt$ represents a small change in the parameter. Conceptually, the formula says: add up many tiny distances, each approximately equal to speed times a small parameter change.

Because

$$
\frac{d\mathbf r}{dt}=x'(t)\mathbf i+y'(t)\mathbf j+z'(t)\mathbf k,
$$

the speed is

$$
\left|\frac{d\mathbf r}{dt}\right|=
\sqrt{(x'(t))^2+(y'(t))^2+(z'(t))^2}.
$$

Therefore the arc-length formula can be written as

$$
s=\int_a^b \sqrt{(x'(t))^2+(y'(t))^2+(z'(t))^2}\,dt.
$$

This version is often the most practical one for computation.

Arc length is a geometric property of the curve, not of the chosen parametrization. If one parametrization traces the same curve faster than another, the derivative becomes larger, but the parameter interval is correspondingly traversed differently. The product “speed times parameter change” still represents a small distance along the curve. This is why arc length does not depend on whether the curve is traced quickly or slowly.

The same formula also gives familiar special cases. If a plane curve is given as a graph

$$
y=f(x),\qquad a\leq x\leq b,
$$

then we may use $x$ itself as the parameter:

$$
\mathbf r(x)=x\mathbf i+f(x)\mathbf j.
$$

Differentiating with respect to $x$ gives

$$
\frac{d\mathbf r}{dx}=\mathbf i+f'(x)\mathbf j.
$$

Its length is

$$
\left|\frac{d\mathbf r}{dx}\right|=
\sqrt{1+(f'(x))^2}.
$$

Thus the arc length is

$$
s=\int_a^b \sqrt{1+(f'(x))^2}\,dx.
$$

Here $f'(x)$ is the derivative of $f$, and the square root accounts for the fact that a small horizontal change $dx$ and a small vertical change $dy=f'(x)\,dx$ combine by the Pythagorean theorem.

For a polar curve

$$
r=g(\theta),\qquad \alpha\leq \theta\leq \beta,
$$

the corresponding Cartesian parametrization is

$$
\mathbf r(\theta)=g(\theta)\cos\theta\,\mathbf i+g(\theta)\sin\theta\,\mathbf j.
$$

The arc-length element becomes

$$
ds=\sqrt{(g(\theta))^2+(g'(\theta))^2}\,d\theta.
$$

Therefore

$$
s=\int_\alpha^\beta \sqrt{(g(\theta))^2+(g'(\theta))^2}\,d\theta.
$$

Here $\theta$ is the polar angle, $g(\theta)$ is the distance from the origin at angle $\theta$, and $g'(\theta)$ measures how that distance changes as the angle changes.

![pasted 1780829881284](/math-2/assets/pasted-1780829881284.png)

Consider the circular helix

$$
\mathbf r(t)=a\cos t\,\mathbf i+a\sin t\,\mathbf j+bt\,\mathbf k.
$$

Here $a>0$ is the radius of the cylinder around which the helix winds, $b$ is the vertical rise per radian of parameter $t$, and $t$ is the angular parameter. Differentiating gives

$$
\mathbf r'(t)=-a\sin t\,\mathbf i+a\cos t\,\mathbf j+b\mathbf k.
$$

The speed is

$$
|\mathbf r'(t)|=
\sqrt{a^2\sin^2t+a^2\cos^2t+b^2}
=\sqrt{a^2+b^2}.
$$

The speed is constant because $\sin^2t+\cos^2t=1$. One full turn corresponds to $0\leq t\leq 2\pi$, so the length of one turn is

$$
s=\int_0^{2\pi}\sqrt{a^2+b^2}\,dt
=2\pi\sqrt{a^2+b^2}.
$$

This formula has a clear geometric meaning: during one full revolution the curve travels around the cylinder while also rising vertically, so the length is larger than the circumference $2\pi a$.

The same helix also gives a clean example of the unit tangent and unit normal. Since

$$
|\mathbf r'(t)|=\sqrt{a^2+b^2},
$$

the unit tangent vector is

$$
\mathbf T(t)=
\frac{-a\sin t\,\mathbf i+a\cos t\,\mathbf j+b\mathbf k}{\sqrt{a^2+b^2}}.
$$

This vector points along the helix, in the direction of increasing $t$, but has length $1$. Differentiating gives

$$
\mathbf T'(t)=
\frac{-a\cos t\,\mathbf i-a\sin t\,\mathbf j}{\sqrt{a^2+b^2}}.
$$

Its length is

$$
|\mathbf T'(t)|=
\frac{a}{\sqrt{a^2+b^2}}.
$$

Therefore the unit normal vector is

$$
\mathbf N(t)=
-\cos t\,\mathbf i-\sin t\,\mathbf j.
$$

Geometrically, this vector points inward toward the axis of the cylinder around which the helix winds. The tangent tells us the direction along the spiral, while the normal tells us the direction in which that tangent direction is bending.

A useful version of the helix example appears when the parameter is actual time. Suppose an ant walks on a cylinder of radius $2$ cm with total speed $5$ cm/s, while its vertical speed is $3$ cm/s. If $\omega$ is its angular speed in radians per second, then the horizontal circular speed is $2\omega$. The total speed condition is

$$
(2\omega)^2+3^2=5^2.
$$

Thus

$$
4\omega^2+9=25,
\qquad
\omega=2.
$$

One full revolution takes time

$$
\frac{2\pi}{\omega}=\frac{2\pi}{2}=\pi.
$$

Since the ant moves at speed $5$ cm/s, the distance travelled in one revolution is

$$
5\pi\text{ cm}.
$$

This example shows why “speed” and “velocity” must be separated. The speed is constant, but the velocity vector is not constant because its horizontal direction keeps turning.

![pasted 1780829906095](/math-2/assets/pasted-1780829906095.png)

A curve is called **piecewise smooth** if it can be split into finitely many smooth arcs. This allows curves with corners or finitely many problematic parameter values, as long as each piece is smooth. If

$$
C=C_1+C_2+\cdots+C_k,
$$

and each piece $C_i$ has a parametrization

$$
\mathbf r_i(t),\qquad a_i\leq t\leq b_i,
$$

then the length of the whole curve is the sum of the lengths of the pieces:

$$
\operatorname{length}(C)=
\sum_{i=1}^k
\int_{a_i}^{b_i}
\left|\frac{d\mathbf r_i}{dt}\right|\,dt.
$$

Here $C_i$ is the $i$-th smooth part of the curve, and the endpoint of one piece must match the starting point of the next piece.

For example, consider

$$
\mathbf r(t)=t^3\mathbf i+t^2\mathbf j,
\qquad -1\leq t\leq 2.
$$

The derivative is

$$
\mathbf r'(t)=3t^2\mathbf i+2t\mathbf j.
$$

The speed is

$$
|\mathbf r'(t)|=
\sqrt{9t^4+4t^2}
=|t|\sqrt{9t^2+4}.
$$

At $t=0$, the velocity vector is $\mathbf 0$, so the curve should be treated carefully. Its length from $t=-1$ to $t=2$ is

$$
s=
\int_{-1}^{2}|t|\sqrt{9t^2+4}\,dt.
$$

Because of the absolute value, split the integral at $t=0$:

$$
s=
\int_{-1}^{0}(-t)\sqrt{9t^2+4}\,dt
+
\int_0^2 t\sqrt{9t^2+4}\,dt.
$$

Using symmetry in the first integral,

$$
s=
\int_0^1 t\sqrt{9t^2+4}\,dt
+
\int_0^2 t\sqrt{9t^2+4}\,dt.
$$

Since

$$
\int t\sqrt{9t^2+4}\,dt
=
\frac{1}{27}(9t^2+4)^{3/2},
$$

the length is

$$
s=
\frac{13^{3/2}-8}{27}
+
\frac{40^{3/2}-8}{27}.
$$

Equivalently,

$$
s=
\frac{13\sqrt{13}+80\sqrt{10}-16}{27}.
$$

The important lesson is not only the final number, but the reason for splitting: the speed formula contains $|t|$, and the parametrization has a singular value at $t=0$.

The final idea in this section is **arc-length parametrization**. Since many different parameters can trace the same curve, it is natural to ask whether there is a parameter that belongs to the curve itself rather than to the chosen coordinate description. Arc length provides such a parameter. Choose a starting point on the curve. For a parametrization $\mathbf r(t)$, define

$$
s=s(t)=\int_{t_0}^{t}\left|\frac{d\mathbf r}{d\tau}(\tau)\right|\,d\tau.
$$

Here $t_0$ is the parameter value at the chosen starting point, $\tau$ is a dummy variable of integration, and $s(t)$ is the distance along the curve from $\mathbf r(t_0)$ to $\mathbf r(t)$, measured in the direction of increasing $t$.

If the equation $s=s(t)$ can be solved for $t$ as a function of $s$, say

$$
t=t(s),
$$

then the curve can be reparametrized by arc length:

$$
\mathbf r(s)=\mathbf r(t(s)).
$$

This is called the **arc-length parametrization** or **intrinsic parametrization**. The word intrinsic means that the parameter $s$ is determined by distance along the curve itself. In an arc-length parametrization, the speed is always $1$:

$$
\left|\frac{d\mathbf r}{ds}\right|=1.
$$

This does not mean the curve is physically moving at speed $1$; it means that the parameter $s$ is literally distance along the curve, so increasing $s$ by one unit moves one unit of length along the curve.

When the curve is parametrized by arc length, the unit tangent formula becomes especially simple. Since

$$
\left|\frac{d\mathbf r}{ds}\right|=1,
$$

we have

$$
\mathbf T(s)=\frac{d\mathbf r}{ds}.
$$

In this form, the derivative is already a unit vector. If this unit tangent changes with $s$, then the unit normal is

$$
\mathbf N(s)=\frac{\mathbf T'(s)}{|\mathbf T'(s)|},
\qquad \mathbf T'(s)\neq \mathbf 0.
$$

This is the cleanest form of the tangent-normal description, because $s$ measures actual distance along the curve rather than an arbitrary parameter.

For the helix

$$
\mathbf r(t)=a\cos t\,\mathbf i+a\sin t\,\mathbf j+bt\,\mathbf k,
$$

measured from $(a,0,0)$ in the direction of increasing $t$, the starting value is $t_0=0$. Since

$$
\left|\mathbf r'(t)\right|=\sqrt{a^2+b^2},
$$

we have

$$
s(t)=\int_0^t\sqrt{a^2+b^2}\,d\tau
=
\sqrt{a^2+b^2}\,t.
$$

Solving for $t$ gives

$$
t=\frac{s}{\sqrt{a^2+b^2}}.
$$

Substituting this into the original parametrization gives the arc-length parametrization

$$
\mathbf r(s)=
a\cos\left(\frac{s}{\sqrt{a^2+b^2}}\right)\mathbf i
+
a\sin\left(\frac{s}{\sqrt{a^2+b^2}}\right)\mathbf j
+
\frac{bs}{\sqrt{a^2+b^2}}\mathbf k.
$$

Every part of this formula has a direct meaning: $s$ is distance travelled along the helix, the angle around the cylinder is $s/\sqrt{a^2+b^2}$, and the height increases proportionally to the distance along the curve.

In summary, parametrization is the method that turns a geometric curve into a vector function of one variable. It allows us to describe curves that are not graphs, curves that arise from intersections of surfaces, and curves whose direction of traversal matters. The derivative of the parametrization gives the tangent direction and speed. Dividing this derivative by its length gives the unit tangent vector, which records only the direction of the curve. When the tangent direction itself changes, the normalized change of the unit tangent gives the unit normal vector, pointing toward the side into which the curve bends. Integrating speed gives arc length, and when arc length itself is used as the parameter, the curve is traced at unit speed.
