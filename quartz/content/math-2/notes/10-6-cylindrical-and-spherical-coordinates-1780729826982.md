---
title: "10.6 Cylindrical and Spherical coordinates"
date: "2026-06-06T07:10:26.982Z"
source: "user-note"
knowledge_type: "user-note"
---

## 10.6 Cylindrical and Spherical coordinates

In three-dimensional geometry, Cartesian coordinates describe a point by measuring how far it lies in the fixed $x$-, $y$-, and $z$-directions. This is often the most direct description, especially for planes, boxes, and objects aligned with the coordinate axes. But many surfaces introduced just before this section are not naturally rectangular. A cylinder such as

$$
x^{2}+y^{2}=4
$$

is not primarily about $x$ and $y$ separately; it is about the distance from the $z$-axis. A sphere such as

$$
x^{2}+y^{2}+z^{2}=9
$$

is not primarily about three separate coordinate distances; it is about the distance from the origin. Cylindrical and spherical coordinates solve exactly this problem: they replace Cartesian coordinates by measurements that match circular, cylindrical, and spherical geometry.

This section appears immediately after quadric surfaces because many of the surfaces just studied become simpler when their symmetry is described directly. A circular cylinder has a fixed distance from an axis. A sphere has a fixed distance from a point. A cone has a fixed angle from an axis. Cylindrical and spherical coordinates give names to those distances and angles, so equations of these surfaces often become shorter and more geometrically transparent.

![pasted 1780730602088](/math-2/assets/pasted-1780730602088.png)

Cylindrical coordinates are obtained by using polar coordinates in the horizontal $xy$-plane and keeping the vertical coordinate $z$ unchanged. A point $P$ in space is described by an ordered triple

$$
[r,\theta,z].
$$

Here $r$ is the distance from the point to the $z$-axis, $\theta$ is the angle in the $xy$-plane measured from the positive $x$-axis to the projection of the point onto the $xy$-plane, and $z$ is the same vertical height used in Cartesian coordinates. The word “cylindrical” is appropriate because the condition $r=\text{constant}$ describes a circular cylinder around the $z$-axis.

The conversion from cylindrical coordinates to Cartesian coordinates is

$$
x=r\cos\theta,\qquad y=r\sin\theta,\qquad z=z.
$$

In this formula, $r\geq 0$ is the radial distance from the $z$-axis, $\theta$ is the angular coordinate in the $xy$-plane, and $z$ is the vertical coordinate. The last equation, $z=z$, does not mean anything mysterious; it only says that cylindrical coordinates do not change the vertical coordinate. Conceptually, the formulas say that the horizontal part of the point is described by polar coordinates, while the vertical height is simply carried along.

The inverse relations explain how to recover cylindrical coordinates from Cartesian coordinates:

$$
r=\sqrt{x^{2}+y^{2}},\qquad \tan\theta=\frac{y}{x},\qquad z=z.
$$

Here $x$, $y$, and $z$ are Cartesian coordinates. The formula for $r$ comes from the Pythagorean theorem in the $xy$-plane. The formula $\tan\theta=y/x$ determines the angle only up to the usual quadrant ambiguity, so the signs of $x$ and $y$ must also be checked. For example, $\tan\theta=1$ could correspond to $\theta=\pi/4$ or $\theta=5\pi/4$, depending on the quadrant.

There is one important convention: $r$ is a distance, so $r$ is never negative. The angle $\theta$ may be chosen from any interval of length $2\pi$, commonly $0\leq \theta<2\pi$ or $-\pi<\theta\leq\pi$. At points on the $z$-axis, $r=0$, and the angle $\theta$ is not unique because every angle points to the same point on the axis. This is not a failure of geometry; it is only a reminder that coordinates are a description of a point, not the point itself.

The distance from the point $P=(x,y,z)$ to the origin is not $r$. The number $r$ measures only horizontal distance from the $z$-axis. The full distance from the origin is

$$
d=\sqrt{x^{2}+y^{2}+z^{2}}=\sqrt{r^{2}+z^{2}}.
$$

Here $d$ denotes the ordinary three-dimensional distance from the origin to the point. This distinction between $r$ and $d$ is one of the most common sources of mistakes. In cylindrical coordinates, $r$ is a two-dimensional radial distance in the horizontal plane, while $d$ is the actual three-dimensional distance from the origin.

The point $(1,1,1)$ has cylindrical coordinates

$$
[\sqrt{2},\pi/4,1],
$$

because its horizontal distance from the $z$-axis is

$$
r=\sqrt{1^{2}+1^{2}}=\sqrt{2},
$$

its projection onto the $xy$-plane lies at angle $\pi/4$, and its height is $z=1$. Similarly, the point $(0,2,-3)$ has cylindrical coordinates

$$
[2,\pi/2,-3],
$$

because it lies two units from the $z$-axis, directly in the positive $y$-direction, and three units below the $xy$-plane. In the other direction, the cylindrical point

$$
[4,-\pi/3,5]
$$

has Cartesian coordinates

$$
x=4\cos(-\pi/3)=2,\qquad
y=4\sin(-\pi/3)=-2\sqrt{3},\qquad
z=5.
$$

Thus the Cartesian coordinates are

$$
(2,-2\sqrt{3},5).
$$

![pasted 1780730630898](/math-2/assets/pasted-1780730630898.png)

A coordinate surface is a surface obtained by holding one coordinate fixed while allowing the others to vary. In Cartesian coordinates, the equations $x=x_{0}$, $y=y_{0}$, and $z=z_{0}$ give coordinate planes. In cylindrical coordinates, the coordinate surfaces have different shapes. The equation

$$
r=r_{0}
$$

describes a vertical circular cylinder centred on the $z$-axis. The equation

$$
\theta=\theta_{0}
$$

describes a vertical half-plane whose edge is the $z$-axis. The equation

$$
z=z_{0}
$$

describes a horizontal plane. These three surfaces intersect at the point whose cylindrical coordinates are $[r_{0},\theta_{0},z_{0}]$, except for the usual non-uniqueness on the $z$-axis.

Coordinate curves are obtained by fixing two coordinates and allowing the third to vary. In cylindrical coordinates, $r$-curves are horizontal radial lines moving away from or toward the $z$-axis, $\theta$-curves are horizontal circles centred on the $z$-axis, and $z$-curves are vertical lines. This gives a geometric way to read cylindrical coordinates: changing $r$ moves outward, changing $\theta$ moves around the axis, and changing $z$ moves up or down.

This also explains why cylindrical coordinates are useful for recognizing surfaces. Consider the equation

$$
z=r^{2}.
$$

Since $r^{2}=x^{2}+y^{2}$, this equation becomes

$$
z=x^{2}+y^{2}.
$$

Therefore it represents a circular paraboloid with vertex at the origin and axis along the positive $z$-axis. In cylindrical coordinates, the symmetry is visible immediately: the height $z$ depends only on the distance $r$ from the axis, not on the angle $\theta$. Rotating the point around the $z$-axis does not change the value of $z$.

Next consider

$$
z=r\cos\theta.
$$

Since $r\cos\theta=x$, this becomes

$$
z=x.
$$

So the equation represents a plane. This example is important because not every equation written with $r$ and $\theta$ represents a curved cylindrical object. The safest method is to translate the equation into Cartesian form and then identify the surface.

Finally, consider

$$
r=2\cos\theta.
$$

Multiplying both sides by $r$ gives

$$
r^{2}=2r\cos\theta.
$$

Using $r^{2}=x^{2}+y^{2}$ and $r\cos\theta=x$, this becomes

$$
x^{2}+y^{2}=2x.
$$

Completing the square gives

$$
(x-1)^{2}+y^{2}=1.
$$

This is a circular cylinder of radius $1$, with central axis parallel to the $z$-axis and passing through $(1,0,0)$. The original equation $r=2\cos\theta$ may not look like a cylinder at first, but conversion reveals that it is a vertical cylinder shifted away from the $z$-axis.

Cylindrical coordinates can also describe curves as intersections of surfaces. For example, the system

$$
r=z,\qquad z=1+r\cos\theta
$$

combines two surface equations. The equation $r=z$ means

$$
z=\sqrt{x^{2}+y^{2}},
$$

which is a right circular half-cone. The equation $z=1+r\cos\theta$ means

$$
z=1+x,
$$

which is a plane. Their intersection is therefore a curve: specifically, the curve where this plane cuts the cone. In this case the intersection is a parabola. The important method is not to memorize the answer, but to translate each cylindrical equation into a familiar Cartesian surface and then interpret the intersection.

A second example is

$$
\theta=\frac{\pi}{2},\qquad r^{2}+z^{2}=4.
$$

The equation $\theta=\pi/2$ describes the half of the $yz$-plane where $y\geq 0$. The equation $r^{2}+z^{2}=4$ becomes

$$
x^{2}+y^{2}+z^{2}=4,
$$

which is a sphere of radius $2$ centred at the origin. The curve is therefore a semicircle lying in the plane $x=0$, with equation

$$
y=\sqrt{4-z^{2}}.
$$

This example shows why coordinate equations should be interpreted geometrically. One equation may define a surface; two independent surface equations usually define a curve.

![pasted 1780730684438](/math-2/assets/pasted-1780730684438.png)

There is a useful distinction between coordinates of a point and components of a vector. A point in cylindrical coordinates is written $[r,\theta,z]$. A vector field in cylindrical coordinates is often written using direction vectors:

$$
\mathbf A=A_{r}\hat r+A_{\theta}\hat\theta+A_{z}\hat k.
$$

Here $\mathbf A$ is a vector, $A_{r}$, $A_{\theta}$, and $A_{z}$ are its components in the local radial, angular, and vertical directions, and $\hat r$, $\hat\theta$, and $\hat k$ are unit vectors. The unit vector $\hat r$ points horizontally outward from the $z$-axis, $\hat\theta$ points in the direction of increasing angle, and $\hat k$ points upward.

The radial unit vector in cylindrical coordinates is

$$
\hat r=\cos\theta\,\hat i+\sin\theta\,\hat j.
$$

Here $\hat i$ and $\hat j$ are the fixed Cartesian unit vectors in the $x$- and $y$-directions. This formula says that the outward radial direction depends on the angle $\theta$. Unlike $\hat i$, $\hat j$, and $\hat k$, the vector $\hat r$ changes from point to point as $\theta$ changes. The angular unit vector is

$$
\hat\theta=-\sin\theta\,\hat i+\cos\theta\,\hat j.
$$

It points tangent to the circle $r=\text{constant}$ in the direction of increasing $\theta$. This idea is already enough to prevent a common error: increasing $\theta$ does not move a point by a distance $\Delta\theta$. If a point is at radius $r$, a small angular change $\Delta\theta$ corresponds to an arc length approximately $r\Delta\theta$. Later, this same geometric fact explains why formulas for velocity, gradients, and volume elements in cylindrical coordinates contain factors of $r$, but those later formulas are not needed to define the coordinate system itself.

![pasted 1780730714114](/math-2/assets/pasted-1780730714114.png)

Spherical coordinates are designed for geometry centred at the origin. A point $P$ is described by an ordered triple

$$
[R,\phi,\theta].
$$

Here $R$ is the distance from $P$ to the origin, $\phi$ is the angle between the line from the origin to $P$ and the positive $z$-axis, and $\theta$ is the same horizontal angle used in cylindrical coordinates. The angle $\phi$ is measured down from the positive $z$-axis, not up from the $xy$-plane. This convention is essential in this course.

The conversion from spherical coordinates to Cartesian coordinates is

$$
x=R\sin\phi\cos\theta,\qquad
y=R\sin\phi\sin\theta,\qquad
z=R\cos\phi.
$$

In these formulas, $R\geq 0$ is the distance from the origin, $0\leq \phi\leq \pi$ is the angle from the positive $z$-axis, and $\theta$ is the angle in the $xy$-plane. The factor $R\sin\phi$ is the horizontal distance from the $z$-axis. Once that horizontal distance is known, the ordinary polar formulas in the $xy$-plane give $x$ and $y$. The vertical coordinate is $R\cos\phi$, because $\phi$ is measured from the $z$-axis.

The relationships between spherical, cylindrical, and Cartesian coordinates are

$$
R^{2}=x^{2}+y^{2}+z^{2}=r^{2}+z^{2},
$$

$$
r=\sqrt{x^{2}+y^{2}}=R\sin\phi,
$$

$$
\tan\phi=\frac{r}{z}=\frac{\sqrt{x^{2}+y^{2}}}{z},
\qquad
\tan\theta=\frac{y}{x}.
$$

Here $r$ is the cylindrical radial distance from the $z$-axis, while $R$ is the spherical radial distance from the origin. This distinction is crucial: $r$ is a horizontal distance, but $R$ is the full three-dimensional distance. Because $\tan\theta=y/x$ and $\tan\phi=r/z$ can both be ambiguous, quadrant and axis cases must be handled carefully.

At points on the $z$-axis, the coordinate $\theta$ is irrelevant because the horizontal projection is the origin. If $\phi=0$, the point lies on the positive $z$-axis; if $\phi=\pi$, it lies on the negative $z$-axis. At the origin, $R=0$, and both angles fail to identify a unique direction. Again, this is not a problem with the point; it is a non-uniqueness in the coordinate description.

![pasted 1780730739620](/math-2/assets/pasted-1780730739620.png)

The coordinate surfaces in spherical coordinates match the geometry of spheres and cones. The equation

$$
R=R_{0}
$$

describes a sphere centred at the origin with radius $R_{0}$. The equation

$$
\phi=\phi_{0}
$$

describes one nappe of a circular cone whose axis is the $z$-axis. The word “nappe” refers to one half of a double cone; because $\phi$ is restricted to $0\leq\phi\leq\pi$, each fixed value of $\phi$ selects one side determined by the angle from the positive $z$-axis. The equation

$$
\theta=\theta_{0}
$$

describes a vertical half-plane with edge along the $z$-axis.

The coordinate curves are also geometrically meaningful. If only $R$ varies, the point moves along a radial line from the origin. If only $\phi$ varies while $R$ and $\theta$ remain fixed, the point moves along a vertical semicircle centred at the origin, beginning and ending on the $z$-axis. If only $\theta$ varies while $R$ and $\phi$ remain fixed, the point moves around a horizontal circle whose centre lies on the $z$-axis.

The Earth gives a useful interpretation, as long as the convention is remembered. If the origin is placed at the Earth’s centre and the positive $z$-axis points through the north pole, then the Earth’s surface is approximately an $R=\text{constant}$ surface. Curves with constant $\phi$ on that surface are horizontal circles around the axis, like parallels of latitude. Curves with constant $\theta$ are meridians, like lines of longitude. However, $\phi$ is not latitude itself. Latitude is measured from the equator, while $\phi$ is measured from the positive $z$-axis. Thus $\phi$ is often called colatitude.

Spherical coordinates make the point

$$
[2,\pi/3,\pi/2]
$$

easy to convert. Using the spherical formulas,

$$
x=2\sin(\pi/3)\cos(\pi/2)=0,
$$

$$
y=2\sin(\pi/3)\sin(\pi/2)=\sqrt{3},
$$

$$
z=2\cos(\pi/3)=1.
$$

So the Cartesian coordinates are

$$
(0,\sqrt{3},1).
$$

In the reverse direction, consider the Cartesian point

$$
Q=(1,1,\sqrt{2}).
$$

The spherical distance from the origin is

$$
R=\sqrt{1^{2}+1^{2}+(\sqrt{2})^{2}}=\sqrt{4}=2.
$$

The horizontal distance from the $z$-axis is

$$
r=\sqrt{1^{2}+1^{2}}=\sqrt{2}.
$$

Therefore

$$
\tan\phi=\frac{r}{z}=\frac{\sqrt{2}}{\sqrt{2}}=1.
$$

Since $z>0$, the point lies above the $xy$-plane, so

$$
\phi=\frac{\pi}{4}.
$$

Also,

$$
\tan\theta=\frac{y}{x}=1.
$$

Since $x>0$ and $y>0$, the point lies in the first quadrant, so

$$
\theta=\frac{\pi}{4}.
$$

Thus the spherical coordinates of $Q$ are

$$
[2,\pi/4,\pi/4].
$$

The order $[R,\phi,\theta]$ should be kept exactly as written. Some books and fields use different conventions, especially for the names and order of the angles. In this course, $R$ is the distance from the origin, $\phi$ is the angle from the positive $z$-axis, and $\theta$ is the horizontal angle in the $xy$-plane. Writing $[R,\theta,\phi]$ instead would swap the two angles and usually give a different point.

The spherical radial unit vector is

$$
\hat R
=
\sin\phi\cos\theta\,\hat i
+
\sin\phi\sin\theta\,\hat j
+
\cos\phi\,\hat k.
$$

Here $\hat R$ points directly away from the origin toward the point. This formula is obtained by taking the Cartesian formula for the position vector and setting the distance $R$ equal to $1$. Thus $\hat R$ is the unit direction corresponding to the spherical radial coordinate. This is not the same as $\hat r$ in cylindrical coordinates: $\hat r$ points horizontally away from the $z$-axis, while $\hat R$ points fully outward from the origin.

This distinction matters in symmetric situations. A field or surface with cylindrical symmetry is unchanged when rotated around the $z$-axis and is usually described naturally using $r$. A field or surface with spherical symmetry is unchanged when rotated around the origin in any direction and is usually described naturally using $R$. For example, $x^{2}+y^{2}=4$ becomes $r=2$, so it is cylindrical in nature. The equation $x^{2}+y^{2}+z^{2}=4$ becomes $R=2$, so it is spherical in nature. The equation $z^{2}=x^{2}+y^{2}$ can be written as $z^{2}=r^{2}$ in cylindrical coordinates, but it is also related to a fixed angle $\phi$ in spherical coordinates; it is a cone, so both descriptions reveal part of its structure.

When calculating distances between two points, the safest method at this stage is to convert both points to Cartesian coordinates and then use the ordinary Euclidean distance formula. For example, suppose

$$
A=[12,3\pi/2,2]
$$

is given in cylindrical coordinates and

$$
B=[2,2\pi/3,\pi/4]
$$

is given in spherical coordinates. First convert:

$$
A=(12\cos(3\pi/2),12\sin(3\pi/2),2)=(0,-12,2).
$$

For $B$,

$$
x=2\sin(2\pi/3)\cos(\pi/4)=\frac{\sqrt{6}}{2},
$$

$$
y=2\sin(2\pi/3)\sin(\pi/4)=\frac{\sqrt{6}}{2},
$$

$$
z=2\cos(2\pi/3)=-1.
$$

Thus

$$
B=\left(\frac{\sqrt6}{2},\frac{\sqrt6}{2},-1\right).
$$

The distance between $A$ and $B$ is

$$
|A-B|
=
\sqrt{
\left(0-\frac{\sqrt6}{2}\right)^{2}
+
\left(-12-\frac{\sqrt6}{2}\right)^{2}
+
(2-(-1))^{2}
}.
$$

Simplifying gives

$$
|A-B|=\sqrt{156+12\sqrt6}.
$$

This example illustrates a general rule: do not combine coordinates from different coordinate systems as if they were the same kind of components. Coordinates are labels relative to a coordinate system. To use the standard distance formula directly, both points must first be expressed in the same Cartesian coordinate system.

The main practical skill in this section is recognizing which coordinate system makes the geometry simple. If a problem contains $x^{2}+y^{2}$, cylindrical coordinates may be natural because $x^{2}+y^{2}=r^{2}$. If a problem contains $x^{2}+y^{2}+z^{2}$, spherical coordinates may be natural because $x^{2}+y^{2}+z^{2}=R^{2}$. If a problem has surfaces such as cylinders around the $z$-axis, vertical half-planes through the $z$-axis, or horizontal planes, cylindrical coordinates often match the boundaries. If it has spheres centred at the origin, cones around the $z$-axis, or vertical half-planes through the $z$-axis, spherical coordinates often match the boundaries.

Later in the course, these same coordinate systems will be used for integration and differentiation in space. Then the fact that an angular step has physical length depending on radius will produce correction factors such as $r$ or $R^{2}\sin\phi$. For the present section, however, the essential point is purely geometric: cylindrical and spherical coordinates are alternative ways to name points and surfaces in 3-space, chosen so that circular, cylindrical, conical, and spherical structures appear directly in the equations.

In summary, cylindrical coordinates $[r,\theta,z]$ describe a point by horizontal distance from the $z$-axis, horizontal angle, and height. They are adapted to cylinders and axial symmetry. Spherical coordinates $[R,\phi,\theta]$ describe a point by distance from the origin and two angles. They are adapted to spheres, cones, and spherical symmetry. Both systems are not new spaces, but new coordinate descriptions of the same three-dimensional space. Their value is that they turn the geometry of many surfaces from complicated Cartesian equations into simple statements about distances and angles.
