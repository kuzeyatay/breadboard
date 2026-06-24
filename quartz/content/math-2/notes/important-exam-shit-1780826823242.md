---
title: "Important exam shit"
date: "2026-06-07T10:07:03.242Z"
source: "user-note"
knowledge_type: "user-note"
---

Based **only on the lecture transcripts**, the most exam-relevant points are these:

### 1. Recognizing geometry from equations

You should be able to look at an equation and immediately understand the object: plane, half-space, sphere, ellipsoid, hyperboloid, paraboloid, cone, cylinder, etc. The lecturer explicitly says the goal of quadric surfaces is that an equation should not look like “just an equation,” but like a surface whose shape you recognize. Also watch the ambient dimension: $x = y$ is a line in $\mathbb R^2$, but a plane in $\mathbb R^3$.

### 2. Coordinate systems and when to change coordinates

Cylindrical, spherical, and polar coordinates are very high-yield. The transcripts repeatedly emphasize that symmetry should guide the coordinate choice, and that coordinate changes make integration and gradient computations easier in symmetric cases. Know the coordinate meanings, the unit vectors, and especially that radial variables like $r$ are nonnegative. Also remember that the unit vectors in cylindrical/spherical coordinates depend on angles.

For integration, the standard transformations matter more than exotic general transformations. The lecturer explicitly says that in the exam the standard coordinate changes are usually emphasized more than the most general case.

### 3. Parametrized curves, velocity, speed, acceleration, and arc length

Know how to work with a curve

$$
\mathbf r(t) = x(t)\mathbf i + y(t)\mathbf j + z(t)\mathbf k.
$$

The derivative $\mathbf r'(t)$ is the velocity/tangent vector, speed is $|\mathbf r'(t)|$, and arc length is obtained by integrating speed. A major trap from the transcript is $\sqrt{t^2} = |t|$, not $t$. If the speed contains $|t|$, you may need to split the integral. The lecturer also says exam arc-length integrals should be solvable by substitution or a known primitive, not by memorizing many integrals.

### 4. Domains, open/closed sets, boundary points, and limits

You should be comfortable finding maximal domains and classifying boundary/interior/exterior points. The transcript spends time clarifying open and closed sets because students had questions about it. Also, multivariable limits are important: the point must be approachable through the domain, and the function must approach the same value no matter how the point is approached. Different paths giving different values means the limit does not exist.

### 5. Level curves, level surfaces, and graphs

Know the difference between a graph $z = f(x,y)$, a level curve $f(x,y) = C$, and a level surface $f(x,y,z) = C$. The lecturer stresses that you must connect the 3D graph of a function with its level-curve picture, because level curves are how you visualize height, contour maps, saddle behavior, and gradients.

### 6. Partial derivatives, tangent planes, normal lines

Partial derivatives are computed by treating all other variables as constants. That sounds basic, but it is central because tangent planes, gradients, normal lines, chain rule, Taylor approximations, and conservative fields all build on it. The transcript directly emphasizes that once you have the gradient, the tangent plane becomes easy because the gradient gives the normal direction.

### 7. Chain rule in several variables

The multivariable chain rule is a major mechanism. The lecturer introduces it through the “hiking on a landscape” example: if height is $f(x,y)$ and your position is $(x(t), y(t))$, then the rate of height change depends on both partial derivatives and both velocity components. The difficult part is not the idea, but the bookkeeping.

### 8. Gradient and directional derivatives

This is one of the most important conceptual blocks. You should know:

$$
D_{\mathbf u}f = \nabla f \cdot \mathbf u
$$

where $\mathbf u$ must be a unit vector. The gradient points in the direction of fastest increase, $-\nabla f$ gives fastest decrease, and directions perpendicular to $\nabla f$ stay on the same level curve/surface. The lecturer spends a lot of time deriving this from the dot product and explicitly connects it to level curves.

### 9. Taylor approximation and the Hessian

You should know second-order Taylor approximation in several variables, including the mixed term. The transcript emphasizes that multivariable Taylor works like one-variable Taylor, but higher-order terms contain combinations of partial derivatives, and mixed terms can appear more than once. This is exactly where mistakes with factors of $2$ happen.

### 10. Double and triple integrals: setup is everything

For integration, the key exam skill is setting up the domain correctly. The lecturer repeatedly explains integrals by slicing: first understand the region, then choose the order of integration, then write bounds. For triple integrals, volume is the integral of $1$, and mass is the integral of density. You should be able to project a 3D solid onto a coordinate plane and determine lower/upper bounds from the surfaces.

### 11. Jacobians and change of variables

This is extremely exam-relevant. The correction factor comes from how small rectangles/cubes deform under a coordinate transformation. In 2D it is the absolute determinant of the Jacobian; in 3D it is the absolute determinant of a $3 \times 3$ Jacobian. For polar coordinates, this gives the famous extra factor $r$. The lecturer explains this geometrically using parallelograms and parallelepipeds.

### 12. Vector fields, conservative fields, divergence, and curl

From the transcripts, vector fields are introduced as assigning a vector to each point in space. Conservative fields are tied to potentials: force or electric field can be obtained as minus the gradient of a potential. Divergence measures sources/sinks, while curl measures rotation. These are not just formulas; the lecturer connects them directly to physics and electromagnetics.

### Highest-yield traps to avoid

Do not forget Jacobian factors such as $r$, $R^2\sin\phi$, or absolute determinants. Do not treat $\sqrt{t^2}$ as $t$. Do not assume a single path proves a multivariable limit exists. Do not confuse a plane equation in $\mathbb R^3$ with a line equation in $\mathbb R^2$. Do not forget that cylindrical and spherical unit vectors change with angle. Do not reverse cross-product order casually, because the cross product is not commutative.
