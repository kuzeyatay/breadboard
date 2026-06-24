---
title: "16.1: Vector and Scalar Fields"
date: "2026-06-16T08:15:35.459Z"
source: "user-note"
knowledge_type: "user-note"
---

# Adams 16.1: Vector and Scalar Fields

Until now, most functions in the course have assigned one number to each point. A function such as $f(x,y)$ or $f(x,y,z)$ can describe height, temperature, density, pressure, or potential. These quantities vary from point to point, but at each point the output is still a single real number. Many physical and engineering situations need more information than this. A wind velocity at a point has both a speed and a direction. A gravitational or electric field tells not only how strong the force would be, but also the direction in which it acts. A rotating body assigns a different velocity vector to different points of the body. To describe such situations, we need fields whose values are vectors rather than scalars.

A scalar field is a function that assigns a real number to each point of a domain. If $\mathcal D\subseteq \mathbb R^d$, then a scalar field has the form

$$
f:\mathcal D\to \mathbb R.
$$

Here $\mathcal D$ is the set of allowed input points, $d$ is the number of spatial coordinates, and $f(\mathbf x)$ is a single real number. For example, if $\mathbf x=(x,y,z)$, then $T(x,y,z)$ could be the temperature at the point $(x,y,z)$. The output is not a direction; it is one scalar value.

A vector-valued function assigns a vector to each input point. In full generality, such a function can have the form

$$
\mathbf F:\mathcal D\subseteq \mathbb R^d\to \mathbb R^n.
$$

This means that the input point lives in $d$-dimensional space, while the output vector has $n$ components. For vector fields in the geometric sense used in this section, the most important case is

$$
\mathbf F:\mathcal D\subseteq \mathbb R^d\to \mathbb R^d.
$$

In this case the output vector lives in the same space as the input point, so it makes sense to attach the vector $\mathbf F(\mathbf x)$ directly to the point $\mathbf x$. This equality of dimensions is what makes field-line pictures meaningful: the arrow at a point points in a direction inside the same space where the point lies.

In three-dimensional Cartesian coordinates, a vector field is usually written as

$$
\mathbf F(x,y,z)=F_1(x,y,z)\mathbf i+F_2(x,y,z)\mathbf j+F_3(x,y,z)\mathbf k.
$$

The vectors $\mathbf i,\mathbf j,\mathbf k$ are the standard unit vectors in the positive $x$-, $y$-, and $z$-directions. The functions $F_1,F_2,F_3$ are scalar-valued component functions. The notation $F_1$ means “the first component of $\mathbf F$,” not a derivative. This matters because later expressions such as $\partial F_1/\partial y$ mean “differentiate the first component with respect to $y$.”

A plane vector field is a vector field in the $xy$-plane. It has the form

$$
\mathbf F(x,y)=F_1(x,y)\mathbf i+F_2(x,y)\mathbf j.
$$

Equivalently, it can be viewed as a three-dimensional field whose $z$-component is zero and whose first two components do not depend on $z$. Plane vector fields are easier to draw because each point in the plane receives a two-dimensional arrow.

A vector field is called smooth if its component functions are sufficiently differentiable. In the strongest textbook sense, this means that all partial derivatives of all orders exist and are continuous. In most computations in this course, only the derivatives that are actually used need to exist and be continuous. For example, to draw a vector field or find basic field lines, one mainly needs the field itself to be defined and continuous on the relevant part of the domain. For later tests involving derivatives of a field, more smoothness is needed.

The position vector of the point $(x,y,z)$ is

$$
\mathbf r=x\mathbf i+y\mathbf j+z\mathbf k.
$$

This notation allows us to write $\mathbf F(\mathbf r)$ instead of $\mathbf F(x,y,z)$. The symbol $\mathbf r$ is a vector. It should not be confused with the polar radius $r$, which is a nonnegative scalar distance. This is one of the most common notation traps in this topic: $\mathbf r$ has direction and magnitude, while $r$ has only magnitude.

![pasted 1781598084745](/math-2/assets/pasted-1781598084745.png)

A basic physical example is the gravitational field of a point mass. Suppose a mass $m$ is located at the point with position vector $\mathbf r_0$. At another point with position vector $\mathbf r$, the gravitational field has the form

$$
\mathbf F(\mathbf r)=-\frac{km}{|\mathbf r-\mathbf r_0|^3}(\mathbf r-\mathbf r_0).
$$

Here $k>0$ is a constant, $m$ is the source mass, $\mathbf r_0$ is the position vector of the source, $\mathbf r$ is the position vector of the point where the field is evaluated, and $|\mathbf r-\mathbf r_0|$ is the distance from the source to that point. The vector $\mathbf r-\mathbf r_0$ points from the source to the evaluation point. The minus sign makes the field point back toward the source, because gravity is attractive. The source point itself is excluded from the domain because the denominator becomes zero there.

An electric point charge gives a similar field, except that the direction may be toward or away from the charge depending on its sign. A positive charge creates an outward-pointing field for a positive test charge, while a gravitational mass creates an inward-pointing field. In both cases, the field is radial: the arrows lie on straight lines through the source point.

![pasted 1781598104639](/math-2/assets/pasted-1781598104639.png)

A different kind of vector field appears in rotation. Suppose a rigid body rotates about the $z$-axis with angular velocity vector

$$
\boldsymbol\Omega=\Omega\mathbf k.
$$

Here $\Omega$ is the angular speed, and $\mathbf k$ is the unit vector in the positive $z$-direction. The velocity field of the rotating body is

$$
\mathbf v(\mathbf r)=\boldsymbol\Omega\times \mathbf r.
$$

Using $\mathbf r=x\mathbf i+y\mathbf j+z\mathbf k$, this becomes

$$
\mathbf v(x,y,z)=-\Omega y\mathbf i+\Omega x\mathbf j.
$$

This field has no $z$-component and does not depend on $z$. At each point, the velocity is tangent to a circle around the $z$-axis. Thus the rotating field is not radial; it is tangential.

A vector field can be drawn by placing arrows at selected points. The tail of each arrow is placed at the point where the field is evaluated, and the arrow points in the direction of the vector assigned to that point. The arrow length may represent the magnitude of the vector, but in many drawings the lengths are scaled so the picture remains readable. The important idea is that a vector field is not a single arrow. It is a rule that assigns an arrow to each point in the domain.

![pasted 1781598136967](/math-2/assets/pasted-1781598136967.png)

Once a vector field is drawn, the eye naturally starts following the arrows. This leads to the idea of a field line. A field line is a curve whose tangent direction agrees with the vector field at every point of the curve. In a velocity field, field lines are often called streamlines or flow lines. In a force field, they are sometimes called lines of force. The name changes with the interpretation, but the mathematical idea is the same: the curve follows the local arrows of the field.

Suppose a field line is parametrized by

$$
\mathbf r(t)=x(t)\mathbf i+y(t)\mathbf j+z(t)\mathbf k,\qquad a\le t\le b.
$$

Here $t$ is a parameter and $\mathbf r(t)$ gives the position of a point moving along the curve. The tangent vector to the curve is

$$
\frac{d\mathbf r}{dt}.
$$

For the curve to be a field line of $\mathbf F$, this tangent vector must point in the same direction as $\mathbf F(\mathbf r(t))$. Therefore,

$$
\frac{d\mathbf r}{dt}=\lambda(t)\mathbf F(\mathbf r(t)).
$$

Here $\lambda(t)$ is a scalar function. It appears because a field line only needs to have the same direction as the field; it does not have to be traversed with the same speed as the vector field. If a particle is actually moving with velocity $\mathbf F$, then one may take $\lambda(t)=1$. For the geometric shape of the field line, only the direction matters. At points where $\mathbf F=\mathbf 0$, the field has no direction, so field lines require special care.

If

$$
\mathbf F(x,y,z)=F_1(x,y,z)\mathbf i+F_2(x,y,z)\mathbf j+F_3(x,y,z)\mathbf k,
$$

then the field-line condition becomes

$$
\frac{dx}{dt}=\lambda(t)F_1(x,y,z),\qquad
\frac{dy}{dt}=\lambda(t)F_2(x,y,z),\qquad
\frac{dz}{dt}=\lambda(t)F_3(x,y,z).
$$

Eliminating the common factor $\lambda(t)\,dt$ gives the compact differential form

$$
\frac{dx}{F_1(x,y,z)}=\frac{dy}{F_2(x,y,z)}=\frac{dz}{F_3(x,y,z)}.
$$

This formula says that the coordinate changes along a field line are proportional to the components of the vector field. It is useful, but it must not be used mechanically when a denominator is zero. If one component of the field is zero, the corresponding coordinate may be constant along the field line.

In the plane, the same idea gives a very useful shortcut. For

$$
\mathbf F(x,y)=F_1(x,y)\mathbf i+F_2(x,y)\mathbf j,
$$

a field line $y=y(x)$ satisfies

$$
\frac{dy}{dx}=\frac{F_2(x,y)}{F_1(x,y)},
$$

where $F_1(x,y)\ne 0$. This formula says that the slope of the field line equals the slope of the vector arrow at that point. If $F_1=0$, the vector is vertical and one should use a different description, often $x=x(y)$, or reason directly from the direction field.

Consider the plane vector field

$$
\mathbf F(x,y)=x\mathbf i+y\mathbf j.
$$

Here $F_1(x,y)=x$ and $F_2(x,y)=y$. Away from the $y$-axis, the field-line equation is

$$
\frac{dy}{dx}=\frac{y}{x}.
$$

Separating variables gives

$$
\frac{dy}{y}=\frac{dx}{x}.
$$

Integrating gives

$$
\ln|y|=\ln|x|+C,
$$

where $C$ is a constant. Equivalently,

$$
y=C_1x.
$$

Thus the field lines are straight lines through the origin. This matches the picture: the vector $x\mathbf i+y\mathbf j$ points radially away from the origin.

Now consider

$$
\mathbf F(x,y)=x\mathbf i-y\mathbf j.
$$

The field-line equation is

$$
\frac{dy}{dx}=-\frac{y}{x}.
$$

Separating variables gives

$$
\frac{dy}{y}=-\frac{dx}{x}.
$$

Therefore,

$$
\ln|y|=-\ln|x|+C,
$$

so

$$
xy=C_1.
$$

The field lines are hyperbolas $xy=C_1$, together with the coordinate-axis cases interpreted separately. This example is useful because the arrows do not simply point outward or around a circle. The field stretches in the $x$-direction and compresses in the $y$-direction, producing hyperbolic flow lines.

For the rotational field

$$
\mathbf F(x,y)=-y\mathbf i+x\mathbf j,
$$

the field-line equation is

$$
\frac{dy}{dx}=\frac{x}{-y}.
$$

Equivalently,

$$
-y\,dy=x\,dx.
$$

So

$$
x\,dx+y\,dy=0.
$$

Integrating gives

$$
\frac{x^2}{2}+\frac{y^2}{2}=C,
$$

or

$$
x^2+y^2=C_1.
$$

Thus the field lines are circles centered at the origin. This agrees with the geometric interpretation: at every point, the vector $-y\mathbf i+x\mathbf j$ is tangent to the circle through that point.

In three dimensions, field lines are space curves. A useful exam-style example is

$$
\mathbf f(x,y,z)=yz\mathbf i+zx\mathbf j+xy\mathbf k.
$$

The field-line equations are

$$
\frac{dx}{yz}=\frac{dy}{zx}=\frac{dz}{xy}.
$$

Comparing the first two fractions gives

$$
zx\,dx=yz\,dy.
$$

Away from points where cancellation is invalid, this reduces to

$$
x\,dx=y\,dy.
$$

Integrating gives

$$
x^2-y^2=C_1.
$$

Comparing the first and third fractions gives

$$
xy\,dx=yz\,dz.
$$

Again, away from points where cancellation is invalid, this reduces to

$$
x\,dx=z\,dz.
$$

Integrating gives

$$
x^2-z^2=C_2.
$$

Therefore, the flow line through $(x_0,y_0,z_0)$ is described implicitly by

$$
x^2-y^2=x_0^2-y_0^2,\qquad
x^2-z^2=x_0^2-z_0^2.
$$

These two equations describe the curve as the intersection of two surfaces. This is common in three-dimensional field-line problems. A parametrization is not always necessary unless the question explicitly asks for one.

![pasted 1781598164195](/math-2/assets/pasted-1781598164195.png)

Some plane vector fields are easier to describe in polar coordinates. In polar coordinates, a point is described by a distance $r\ge 0$ from the origin and an angle $\theta$. The corresponding unit vectors are

$$
\hat{\mathbf r}=\cos\theta\,\mathbf i+\sin\theta\,\mathbf j,
$$

and

$$
\hat{\boldsymbol\theta}=-\sin\theta\,\mathbf i+\cos\theta\,\mathbf j.
$$

The vector $\hat{\mathbf r}$ points radially outward, in the direction of increasing $r$. The vector $\hat{\boldsymbol\theta}$ points tangentially, in the direction of increasing $\theta$. These unit vectors depend on $\theta$, so they change from point to point. They are not fixed like $\mathbf i$ and $\mathbf j$. They are also not defined at the origin, because the angle $\theta$ is not defined there.

A plane vector field can be written in polar form as

$$
\mathbf F(r,\theta)=F_r(r,\theta)\hat{\mathbf r}+F_\theta(r,\theta)\hat{\boldsymbol\theta}.
$$

Here $F_r(r,\theta)$ is the radial component and $F_\theta(r,\theta)$ is the tangential component. The subscripts $r$ and $\theta$ label polar components. They do not mean partial derivatives.

To find field lines in polar form, suppose the curve is described by

$$
r=r(\theta).
$$

The position vector is

$$
\mathbf r=r\hat{\mathbf r}.
$$

A small displacement along the curve is

$$
d\mathbf r=dr\,\hat{\mathbf r}+r\,d\theta\,\hat{\boldsymbol\theta}.
$$

The first term is radial displacement. The second term is tangential displacement. The factor $r$ appears because a small change $d\theta$ sweeps out an arc length $r\,d\theta$. For the curve to be a field line, this displacement must be parallel to

$$
F_r(r,\theta)\hat{\mathbf r}+F_\theta(r,\theta)\hat{\boldsymbol\theta}.
$$

Therefore,

$$
\frac{dr}{F_r(r,\theta)}=\frac{r\,d\theta}{F_\theta(r,\theta)}.
$$

When $F_\theta(r,\theta)\ne 0$, this can be written as

$$
\frac{dr}{d\theta}=r\frac{F_r(r,\theta)}{F_\theta(r,\theta)}.
$$

This is the polar-coordinate field-line equation. It should be used only after the polar components have been correctly identified. A purely radial field, where $F_\theta=0$, has field lines with constant $\theta$. A purely tangential field, where $F_r=0$, has field lines with constant $r$.

For example, consider

$$
\mathbf F=\hat{\mathbf r}+\hat{\boldsymbol\theta}.
$$

Here

$$
F_r=1,\qquad F_\theta=1.
$$

The polar field-line equation becomes

$$
\frac{dr}{1}=\frac{r\,d\theta}{1},
$$

so

$$
\frac{dr}{d\theta}=r.
$$

Solving gives

$$
r=Ce^\theta,
$$

where $C>0$ is a constant. Thus the field lines are logarithmic spirals. This makes sense geometrically: the field has both an outward radial component and a tangential component, so a particle following the field both moves outward and turns.

As a second polar example, consider

$$
\mathbf F=r\hat{\mathbf r}-\hat{\boldsymbol\theta}.
$$

Here

$$
F_r=r,\qquad F_\theta=-1.
$$

The polar field-line equation gives

$$
\frac{dr}{r}=\frac{r\,d\theta}{-1}.
$$

Equivalently,

$$
\frac{dr}{d\theta}=-r^2.
$$

Separating variables gives

$$
\frac{dr}{r^2}=-d\theta.
$$

Integrating gives

$$
-\frac{1}{r}=-\theta+C,
$$

or

$$
\frac{1}{r}=\theta+C_1.
$$

Therefore,

$$
r=\frac{1}{\theta+C_1}.
$$

This example shows why one should not guess that every polar field line is a circle or an exponential spiral. The equation depends on the ratio between the radial component and the tangential component.

The gradient gives an important bridge between scalar fields and vector fields. If $f(x,y,z)$ is a scalar field, then its gradient is

$$
\nabla f=\frac{\partial f}{\partial x}\mathbf i+\frac{\partial f}{\partial y}\mathbf j+\frac{\partial f}{\partial z}\mathbf k.
$$

This is a vector field because it assigns a vector to each point where the partial derivatives exist. The gradient points in the direction of fastest increase of the scalar field and is perpendicular to the level surfaces of the scalar field. Thus a scalar field can produce a vector field by differentiation.

Not every vector field arises as the gradient of a scalar field. The special vector fields that do arise in this way are studied separately as conservative fields. For the present section, the essential distinction is simpler: a scalar field assigns one number to each point, while a vector field assigns a vector to each point. Field lines are curves tangent to those assigned vectors. In Cartesian coordinates, the basis vectors $\mathbf i,\mathbf j,\mathbf k$ are fixed; in polar coordinates, $\hat{\mathbf r}$ and $\hat{\boldsymbol\theta}$ move from point to point. Most mistakes in this section come from confusing these roles: mistaking a component for a derivative, treating a vector field as a single vector, forgetting zero-field points, or applying the field-line formulas where a denominator vanishes.

The section’s main idea is therefore that fields describe spatially varying quantities. Scalar fields describe quantities with size only; vector fields describe quantities with size and direction. Field lines then convert a vector field into a family of curves that make the direction of the field visible and computable.
