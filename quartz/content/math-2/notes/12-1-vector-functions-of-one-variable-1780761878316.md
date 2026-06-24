---
title: "12.1 Vector Functions of One Variable"
date: "2026-06-06T16:04:38.316Z"
source: "user-note"
knowledge_type: "user-note"
---

# 12.1 Vector Functions of One Variable

The previous geometry sections describe points, curves, and surfaces in three-dimensional space. That is enough when the object is fixed. But many engineering and physics problems are not only about where something is; they are about how its position changes. A particle, a car, a slider in a rotating arm, or an ant walking around a cylinder has a position that depends on time. To describe such motion, we need a function whose input is one real number, usually time, and whose output is a vector in space. This is the purpose of a vector function of one variable.

A vector function of one variable is a rule that assigns a vector to each value of one real parameter. In this section the parameter will usually be denoted by $t$, because the most natural interpretation is time. If the moving point has Cartesian coordinates $x(t)$, $y(t)$, and $z(t)$ at time $t$, then instead of writing three separate equations

$$
x=x(t),\qquad y=y(t),\qquad z=z(t),
$$

we combine them into one vector equation

$$
\mathbf r(t)=x(t)\mathbf i+y(t)\mathbf j+z(t)\mathbf k.
$$

Here $\mathbf r(t)$ is the position vector of the particle at time $t$, meaning the vector from the origin to the particle. The functions $x(t)$, $y(t)$, and $z(t)$ are the component functions of $\mathbf r(t)$, and $\mathbf i$, $\mathbf j$, and $\mathbf k$ are the fixed unit vectors in the positive $x$-, $y$-, and $z$-directions. If $z(t)=0$, then the motion lies in the $xy$-plane, and the third component is often omitted.

This is not the same kind of object as a vector field. A vector function of one variable has one real input, such as time, and gives one vector output. Symbolically, it has the form

$$
\mathbf r:I\subseteq \mathbb R\to \mathbb R^{3}.
$$

Here $I$ is an interval of real numbers, usually a time interval. A vector field, which belongs mainly to later material, assigns a vector to each point in a region of space. In the present section the input is not a point in space; it is one parameter $t$. This distinction matters because differentiating with respect to time is different from differentiating with respect to spatial variables.

As $t$ changes, the endpoint of $\mathbf r(t)$ traces a path in space. That path is a curve. The vector function contains more information than the geometric curve alone, because it also describes how the curve is traced: where the particle is at each time, in which direction it is moving, and how fast it moves. Two different vector functions can trace the same geometric curve at different speeds or in opposite directions. In this section, the emphasis is on motion: position, velocity, speed, and acceleration.

A vector function $\mathbf r(t)$ is called continuous at a time $t_0$ if the particle does not jump suddenly at $t_0$. In terms of components, this means that $x(t)$, $y(t)$, and $z(t)$ are continuous at $t_0$. Thus continuity of a vector function is checked component by component. This matches the physical picture: a continuous motion is one in which each coordinate changes continuously.

![pasted 1780762378910](/math-2/assets/pasted-1780762378910.png)

The first quantity we want from a moving point is its velocity. Over a time interval from $t$ to $t+\Delta t$, the particle moves from $\mathbf r(t)$ to $\mathbf r(t+\Delta t)$. The displacement over this interval is

$$
\mathbf r(t+\Delta t)-\mathbf r(t).
$$

Here $\Delta t$ is the change in time. Displacement is a vector: it records both how far the particle moved and in which direction. To measure average velocity, we divide this displacement by the elapsed time:

$$
\frac{\mathbf r(t+\Delta t)-\mathbf r(t)}{\Delta t}.
$$

This average velocity points in the direction of the secant line from the old position to the new position. If we let the time interval shrink toward zero, the secant direction approaches the tangent direction to the path. This limiting vector is the instantaneous velocity.

The velocity of the particle at time $t$ is

$$
\mathbf v(t)=\lim_{\Delta t\to 0}\frac{\mathbf r(t+\Delta t)-\mathbf r(t)}{\Delta t}=\frac{d\mathbf r}{dt}.
$$

Here $\mathbf v(t)$ is the velocity vector, $\Delta t$ is a small time change, and $d\mathbf r/dt$ denotes the derivative of the position vector with respect to time. The velocity vector is tangent to the path at the point $\mathbf r(t)$, and it points in the direction of motion.

Because the basis vectors $\mathbf i,\mathbf j,\mathbf k$ are fixed, differentiating a Cartesian position vector is done component by component:

$$
\frac{d\mathbf r}{dt}=\frac{dx}{dt}\mathbf i+\frac{dy}{dt}\mathbf j+\frac{dz}{dt}\mathbf k.
$$

Here $dx/dt$, $dy/dt$, and $dz/dt$ are the rates of change of the three Cartesian coordinates. The formula says that the velocity vector is built from the ordinary one-variable derivatives of the coordinate functions. If $x$, $y$, and $z$ are measured in metres and $t$ is measured in seconds, then each velocity component is measured in metres per second.

The speed of the particle is the length of the velocity vector:

$$
v(t)=|\mathbf v(t)|.
$$

Here $v(t)$ without boldface is a scalar, while $\mathbf v(t)$ in boldface is a vector. The velocity tells both direction and rate of motion; the speed tells only how fast the particle is moving. In Cartesian components,

$$
v(t)=\sqrt{\left(\frac{dx}{dt}\right)^2+\left(\frac{dy}{dt}\right)^2+\left(\frac{dz}{dt}\right)^2}.
$$

This formula follows from the ordinary length formula for vectors in three-dimensional space. It measures the magnitude of the velocity vector, not the length of the path already travelled.

The next quantity is acceleration. Velocity describes how position changes. Acceleration describes how velocity changes. Therefore acceleration is the derivative of velocity:

$$
\mathbf a(t)=\frac{d\mathbf v}{dt}=\frac{d^2\mathbf r}{dt^2}.
$$

Here $\mathbf a(t)$ is the acceleration vector, $d\mathbf v/dt$ is the derivative of velocity with respect to time, and $d^2\mathbf r/dt^2$ is the second derivative of position with respect to time. In Cartesian components,

$$
\mathbf a(t)=\frac{d^2x}{dt^2}\mathbf i+\frac{d^2y}{dt^2}\mathbf j+\frac{d^2z}{dt^2}\mathbf k.
$$

The acceleration vector does not necessarily point in the direction of motion. It points in the direction in which the velocity vector is changing. A particle moving in a circle at constant speed has changing velocity because its direction changes, so it has acceleration even though its speed remains constant.

A curve is called smooth at a point if its velocity exists, varies continuously nearby, and is not the zero vector at that point. The nonzero condition is important. If $\mathbf v(t)=\mathbf 0$, then the particle is instantaneously at rest, and the tangent direction may fail to be well-defined even when all coordinate functions are differentiable.

![pasted 1780762401292](/math-2/assets/pasted-1780762401292.png)

Consider the plane curve

$$
\mathbf r(t)=t^3\mathbf i+t^2\mathbf j.
$$

Here $x(t)=t^3$, $y(t)=t^2$, and $z(t)=0$. The velocity is

$$
\mathbf v(t)=3t^2\mathbf i+2t\mathbf j.
$$

At $t=0$, this becomes

$$
\mathbf v(0)=\mathbf 0.
$$

Although the component functions $t^3$ and $t^2$ are differentiable for all $t$, the curve is not smooth at the origin because the velocity vanishes there. This example separates two ideas that are easy to confuse: a vector function can have differentiable components, while the geometric path it traces can still fail to have a well-defined tangent direction at a particular point.

The same differentiation rules used for real-valued functions extend to vector-valued functions, provided we respect what kind of object each operation produces. If $\mathbf u(t)$ and $\mathbf w(t)$ are differentiable vector functions, and $\lambda(t)$ is a differentiable scalar function, then

$$
\frac{d}{dt}\big(\mathbf u(t)+\mathbf w(t)\big)=\frac{d\mathbf u}{dt}+\frac{d\mathbf w}{dt}.
$$

For scalar multiplication,

$$
\frac{d}{dt}\big(\lambda(t)\mathbf u(t)\big)=\lambda'(t)\mathbf u(t)+\lambda(t)\mathbf u'(t).
$$

If two vector functions are combined by the dot product, the result is a scalar function. Its derivative is

$$
\frac{d}{dt}\big(\mathbf u(t)\cdot\mathbf w(t)\big)=\mathbf u'(t)\cdot\mathbf w(t)+\mathbf u(t)\cdot\mathbf w'(t).
$$

If two vector functions in three-dimensional space are combined by the cross product, the result is a vector function. Its derivative is

$$
\frac{d}{dt}\big(\mathbf u(t)\times\mathbf w(t)\big)=\mathbf u'(t)\times\mathbf w(t)+\mathbf u(t)\times\mathbf w'(t).
$$

Here the order of the factors matters because the cross product is not commutative. Therefore the order shown in the formula must be preserved.

The chain rule is also needed. If $\mathbf u$ is a vector function of a scalar variable $\lambda$, and $\lambda=\lambda(t)$, then $\mathbf u(\lambda(t))$ is a vector function of $t$. Its derivative is

$$
\frac{d}{dt}\mathbf u(\lambda(t))=\frac{d\mathbf u}{d\lambda}(\lambda(t))\frac{d\lambda}{dt}.
$$

A useful example is the conical helix

$$
\mathbf r(t)=t\cos t\,\mathbf i+t\sin t\,\mathbf j+t\,\mathbf k.
$$

This position vector describes a point whose height is $z=t$, while its horizontal distance from the $z$-axis is also $t$. The point therefore spirals upward while moving farther from the axis. Differentiating component by component gives

$$
\mathbf v(t)=(\cos t-t\sin t)\mathbf i+(\sin t+t\cos t)\mathbf j+\mathbf k.
$$

The speed is

$$
v(t)=|\mathbf v(t)|=\sqrt{(\cos t-t\sin t)^2+(\sin t+t\cos t)^2+1}.
$$

Expanding the first two squares gives

$$
(\cos t-t\sin t)^2+(\sin t+t\cos t)^2=1+t^2,
$$

because the mixed terms cancel and $\sin^2t+\cos^2t=1$. Therefore

$$
v(t)=\sqrt{t^2+2}.
$$

The acceleration is

$$
\mathbf a(t)=(-2\sin t-t\cos t)\mathbf i+(2\cos t-t\sin t)\mathbf j.
$$

The $\mathbf k$-component is zero because the vertical velocity is constant: $dz/dt=1$, so $d^2z/dt^2=0$. This example shows how vector differentiation reduces to ordinary one-variable differentiation of components, while the final result remains a vector.

A special but important case occurs when acceleration is constant. Suppose a particle has constant acceleration

$$
\mathbf a(t)=\mathbf a_0.
$$

Since acceleration is the derivative of velocity, integrating once gives

$$
\mathbf v(t)=\mathbf v_0+t\mathbf a_0.
$$

Here $\mathbf v_0=\mathbf v(0)$ is the initial velocity. Integrating again gives

$$
\mathbf r(t)=\mathbf r_0+t\mathbf v_0+\frac12t^2\mathbf a_0.
$$

Here $\mathbf r_0=\mathbf r(0)$ is the initial position. These are the vector forms of the familiar constant-acceleration equations from one-variable motion. They work in three dimensions because each component satisfies the corresponding one-dimensional equation.

For example, if the constant acceleration is a gravitational acceleration vector $\mathbf g$, then

$$
\mathbf v(t)=\mathbf v_0+t\mathbf g,\qquad \mathbf r(t)=\mathbf r_0+t\mathbf v_0+\frac12t^2\mathbf g.
$$

Here $\mathbf g$ is a vector, not merely a positive number. If the positive $z$-direction is upward, then near the Earth’s surface one often writes $\mathbf g=-g\mathbf k$, where $g\approx 9.8\,\text{m/s}^2$ is the magnitude of gravitational acceleration. The minus sign records that the acceleration points downward.

The dot product gives a compact way to understand when speed is constant. Since speed is the length of velocity,

$$
v(t)=|\mathbf v(t)|.
$$

Instead of differentiating the square root directly, it is cleaner to square the speed:

$$
v(t)^2=|\mathbf v(t)|^2=\mathbf v(t)\cdot\mathbf v(t).
$$

Differentiating both sides gives

$$
\frac{d}{dt}\big(v(t)^2\big)=2\mathbf v(t)\cdot\mathbf a(t).
$$

Here $\mathbf a(t)=\mathbf v'(t)$. Therefore the speed is constant exactly when $v(t)^2$ is constant, which happens when

$$
\mathbf v(t)\cdot\mathbf a(t)=0
$$

for all times in the interval considered. The dot product of two vectors is zero when the vectors are perpendicular. Thus a particle has constant speed precisely when its acceleration is always perpendicular to its velocity. This explains uniform circular motion: the particle keeps the same speed because the acceleration changes the direction of the velocity, not its length.

The expression

$$
\mathbf r(t)-t\mathbf v(t)
$$

is a useful example of how vector differentiation can prove a geometric property. Suppose that, at every time $t$, the acceleration $\mathbf a(t)$ is perpendicular to both $\mathbf r(t)$ and $\mathbf v(t)$. We want to show that $\mathbf r(t)-t\mathbf v(t)$ has constant length. Let

$$
\mathbf q(t)=\mathbf r(t)-t\mathbf v(t).
$$

Its derivative is

$$
\mathbf q'(t)=\mathbf v(t)-\big(\mathbf v(t)+t\mathbf a(t)\big)=-t\mathbf a(t),
$$

where the product rule was used on $t\mathbf v(t)$. To prove that $\mathbf q(t)$ has constant length, differentiate its squared length:

$$
\frac{d}{dt}|\mathbf q(t)|^2=\frac{d}{dt}\big(\mathbf q(t)\cdot\mathbf q(t)\big)=2\mathbf q(t)\cdot\mathbf q'(t).
$$

Substituting $\mathbf q(t)=\mathbf r(t)-t\mathbf v(t)$ and $\mathbf q'(t)=-t\mathbf a(t)$ gives

$$
2\big(\mathbf r(t)-t\mathbf v(t)\big)\cdot\big(-t\mathbf a(t)\big).
$$

Because $\mathbf a(t)$ is perpendicular to both $\mathbf r(t)$ and $\mathbf v(t)$, both dot products are zero. Hence

$$
\frac{d}{dt}|\mathbf q(t)|^2=0.
$$

So $|\mathbf q(t)|^2$ is constant, and therefore $|\mathbf q(t)|$ is constant. This is a typical 12.1 argument: convert a geometric statement about length into a derivative of a dot product.

![pasted 1780762484731](/math-2/assets/pasted-1780762484731.png)

The Cartesian formulas above are simple because $\mathbf i$, $\mathbf j$, and $\mathbf k$ are fixed directions. In cylindrical coordinates, the situation is subtler. The point is described by a radial distance $r$, an angle $\theta$, and a height $z$. The associated unit vectors are $\hat r$, $\hat\theta$, and $\hat k$. Here $\hat r$ points horizontally outward from the $z$-axis, $\hat\theta$ points in the direction of increasing angle, and $\hat k$ points upward.

The cylindrical position vector is

$$
\mathbf r_P=r\hat r+z\hat k.
$$

Here $\mathbf r_P$ is the position vector of the point $P$, while $r$ is the scalar cylindrical radial coordinate. The notation is similar, so the distinction must be kept clear: bold $\mathbf r_P$ denotes a vector, whereas non-bold $r$ denotes a distance from the $z$-axis. There is no separate term $\theta\hat\theta$ in the position vector because $\theta$ is an angle, not a distance. The angular information is already contained in the direction of $\hat r$.

The cylindrical unit vectors in the horizontal plane are

$$
\hat r=\cos\theta\,\mathbf i+\sin\theta\,\mathbf j,
$$

$$
\hat\theta=-\sin\theta\,\mathbf i+\cos\theta\,\mathbf j.
$$

Differentiating them with respect to $\theta$ gives

$$
\frac{d\hat r}{d\theta}=\hat\theta,\qquad \frac{d\hat\theta}{d\theta}=-\hat r.
$$

The first equation says that as the radial direction rotates, its instantaneous change points tangentially. The second says that as the tangential direction rotates, its instantaneous change points inward. These formulas are the key difference between Cartesian and cylindrical motion.

If a moving point has cylindrical coordinates

$$
r=r(t),\qquad \theta=\theta(t),\qquad z=z(t),
$$

then its position vector is

$$
\mathbf r_P(t)=r(t)\hat r(\theta(t))+z(t)\hat k.
$$

Differentiating requires both the product rule and the chain rule:

$$
\mathbf v=\dot r\,\hat r+r\dot\theta\,\hat\theta+\dot z\,\hat k.
$$

Here $\dot r=dr/dt$, $\dot\theta=d\theta/dt$, and $\dot z=dz/dt$. The term $\dot r\,\hat r$ is radial velocity, the term $r\dot\theta\,\hat\theta$ is tangential velocity around the $z$-axis, and the term $\dot z\,\hat k$ is vertical velocity. The factor $r$ is essential because angular velocity $\dot\theta$ is measured in radians per second, not metres per second. At radius $r$, a small angular change $d\theta$ corresponds to an arc length $r\,d\theta$.

Differentiating velocity once more gives the cylindrical acceleration formula

$$
\mathbf a=(\ddot r-r\dot\theta^2)\hat r+(r\ddot\theta+2\dot r\dot\theta)\hat\theta+\ddot z\,\hat k.
$$

Here $\ddot r=d^2r/dt^2$, $\ddot\theta=d^2\theta/dt^2$, and $\ddot z=d^2z/dt^2$. The radial component has two parts: $\ddot r$, which measures direct radial acceleration, and $-r\dot\theta^2$, which is the inward acceleration caused by turning. The angular component also has two parts: $r\ddot\theta$, which comes from angular acceleration, and $2\dot r\dot\theta$, which appears when the particle changes radius while rotating.

For uniform circular motion at fixed height, suppose

$$
r=a,\qquad \dot r=0,\qquad \dot\theta=\omega,\qquad \ddot\theta=0,\qquad \dot z=0.
$$

Here $a$ is the fixed radius and $\omega$ is the constant angular velocity. The velocity becomes

$$
\mathbf v=a\omega\,\hat\theta,
$$

and the acceleration becomes

$$
\mathbf a=-a\omega^2\hat r.
$$

Thus the velocity is tangent to the circular path, while the acceleration points inward toward the axis. This is the vector explanation of constant-speed circular motion: the speed stays constant, but the direction of velocity keeps changing.

![pasted 1780762582606](/math-2/assets/pasted-1780762582606.png)

A typical cylindrical velocity calculation is a slider in a rotating slotted arm. Suppose the slider has

$$
r(t)=1.6-0.2t
$$

and

$$
\theta(t)=0.8t-0.05t^2,
$$

with $r$ measured in metres, $\theta$ measured in radians, and $t$ measured in seconds. Assume the motion is horizontal, so $z$ is constant. At $t=1$,

$$
r(1)=1.6-0.2=1.4,
$$

$$
\dot r(t)=-0.2,
$$

and

$$
\dot\theta(t)=0.8-0.1t,\qquad \dot\theta(1)=0.7.
$$

Substituting into the cylindrical velocity formula gives

$$
\mathbf v(1)=\dot r(1)\hat r+r(1)\dot\theta(1)\hat\theta=-0.2\hat r+1.4(0.7)\hat\theta.
$$

Therefore

$$
\mathbf v(1)=-0.2\hat r+0.98\hat\theta.
$$

The negative radial component means that the slider is moving inward. The positive tangential component means that it is also moving in the direction of increasing $\theta$. The coefficient $0.98$ is not $\dot\theta$; it is $r\dot\theta$, the actual tangential speed in metres per second.

This example also gives an important warning: when using cylindrical coordinates, do not write the velocity as $\dot r\hat r+\dot\theta\hat\theta+\dot z\hat k$. That expression has the wrong units, because $\dot\theta$ is angular speed, not linear speed. The correct tangential term is $r\dot\theta\hat\theta$.

The same distinction appears throughout this section: coordinates describe position, while derivatives describe motion. The scalar $r(t)$ tells the distance from the axis. The derivative $\dot r(t)$ tells how fast that distance changes. The angle $\theta(t)$ tells angular position. The derivative $\dot\theta(t)$ tells angular speed. The product $r(t)\dot\theta(t)$ tells tangential speed. These quantities look similar, but they answer different questions.

In summary, a vector function of one variable packages several coordinate functions into a single moving position vector. Differentiating that position gives velocity, whose magnitude is speed; differentiating velocity gives acceleration. In Cartesian coordinates, differentiation is componentwise because the basis vectors are fixed. In cylindrical coordinates, the basis vectors $\hat r$ and $\hat\theta$ rotate with the angle, so their derivatives must be included. The central skill of this section is to translate motion into a vector function, then use differentiation rules carefully to extract direction, speed, acceleration, and geometric behaviour from that function.
