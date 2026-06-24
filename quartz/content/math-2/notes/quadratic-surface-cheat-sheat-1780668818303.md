---
title: "Quadratic surface cheat sheet"
date: "2026-06-05T14:13:38.303Z"
source: "user-note"
knowledge_type: "user-note"
---

## Quadratic Surface Cheat Sheet

### A. Ellipsoid

Standard form:

$$
\frac{(x-x_0)^2}{a^2}+\frac{(y-y_0)^2}{b^2}+\frac{(z-z_0)^2}{c^2}=1
$$

Recognition:

- Three squared variables.
- All signs are positive.
- Equal to $1$.

Shape: closed oval surface.

Special case: if $a=b=c$, it is a sphere:

$$
(x-x_0)^2+(y-y_0)^2+(z-z_0)^2=r^2
$$

### B. Elliptic Cone

Standard form:

$$
\frac{(z-z_0)^2}{c^2}=\frac{(x-x_0)^2}{a^2}+\frac{(y-y_0)^2}{b^2}
$$

Equivalent form:

$$
\frac{(x-x_0)^2}{a^2}+\frac{(y-y_0)^2}{b^2}-\frac{(z-z_0)^2}{c^2}=0
$$

Recognition:

- Three squared variables.
- Mixed signs.
- Right-hand side is $0$.
- No linear variable remains after completing squares.

Shape: double cone.

Axis: along the variable that has the opposite sign.

For example,

$$
\frac{z^2}{c^2}=\frac{x^2}{a^2}+\frac{y^2}{b^2}
$$

has axis along the $z$-axis.

### C. Hyperboloid of One Sheet

Standard form:

$$
\frac{x^2}{a^2}+\frac{y^2}{b^2}-\frac{z^2}{c^2}=1
$$

Recognition:

- Three squared variables.
- Two positive signs and one negative sign.
- Equal to $1$.
- The negative variable gives the axis.

Shape: connected hourglass-like surface.

Example:

$$
\frac{x^2}{4}+\frac{y^2}{9}-\frac{z^2}{16}=1
$$

is a hyperboloid of one sheet around the $z$-axis.

Memory trick: one minus means one sheet.

### D. Hyperboloid of Two Sheets

Standard form:

$$
\frac{z^2}{c^2}-\frac{x^2}{a^2}-\frac{y^2}{b^2}=1
$$

Recognition:

- Three squared variables.
- One positive sign and two negative signs.
- Equal to $1$.
- The positive variable gives the axis.

Shape: two disconnected pieces.

Example:

$$
\frac{z^2}{9}-\frac{x^2}{4}-\frac{y^2}{4}=1
$$

is a hyperboloid of two sheets along the $z$-axis.

Memory trick: two minuses means two sheets.

### E. Elliptic Paraboloid

Standard form:

$$
z-z_0=\frac{(x-x_0)^2}{a^2}+\frac{(y-y_0)^2}{b^2}
$$

Recognition:

- Two squared variables.
- One linear variable.
- Squared terms have the same sign.

Shape: bowl.

Examples:

$$
z=x^2+y^2
$$

opens upward.

$$
z=-x^2-y^2
$$

opens downward.

The linear variable tells the direction of opening.

If the equation is

$$
x=y^2+z^2
$$

then it opens along the $x$-axis.

### F. Hyperbolic Paraboloid

Standard form:

$$
z-z_0=\frac{(x-x_0)^2}{a^2}-\frac{(y-y_0)^2}{b^2}
$$

Recognition:

- Two squared variables.
- One linear variable.
- Squared terms have opposite signs.

Shape: saddle.

Example:

$$
z=x^2-y^2
$$

### G. Elliptic Cylinder

Standard form:

$$
\frac{(x-x_0)^2}{a^2}+\frac{(y-y_0)^2}{b^2}=1
$$

Recognition:

- Only two squared variables.
- Third variable is missing.
- Same signs.
- Equal to $1$.

Shape: ellipse extruded along the missing variable.

Example:

$$
\frac{x^2}{4}+\frac{y^2}{9}=1
$$

is an elliptic cylinder along the $z$-axis because $z$ is missing.

Special case:

$$
x^2+y^2=r^2
$$

is a circular cylinder.

### H. Hyperbolic Cylinder

Standard form:

$$
\frac{x^2}{a^2}-\frac{y^2}{b^2}=1
$$

Recognition:

- Only two squared variables.
- Third variable is missing.
- Opposite signs.
- Equal to $1$.

Shape: hyperbola extruded along the missing variable.

Example:

$$
x^2-y^2=1
$$

is a hyperbolic cylinder along the $z$-axis.

### I. Parabolic Cylinder

Standard form:

$$
y-y_0=a(x-x_0)^2
$$

Recognition:

- One squared variable.
- One linear variable.
- One variable is missing.

Shape: parabola extruded along the missing variable.

Example:

$$
y=x^2
$$

is a parabolic cylinder along the $z$-axis.

### J. Pair of Planes

Standard forms:

$$
x^2=a^2
$$

which gives

$$
x=\pm a
$$

so it is a pair of parallel planes.

Also,

$$
x^2-y^2=0
$$

factors as

$$
(x-y)(x+y)=0
$$

so it gives the two planes

$$
x=y
$$

and

$$
x=-y
$$

Recognition:

- Equation factors into two linear factors.
- Often appears as a degenerate quadric.

## Fast Recognition Table

| Form | Surface |
|---|---|
| $\frac{x^2}{a^2}+\frac{y^2}{b^2}+\frac{z^2}{c^2}=1$ | Ellipsoid |
| $x^2+y^2+z^2=r^2$ | Sphere |
| $\frac{x^2}{a^2}+\frac{y^2}{b^2}-\frac{z^2}{c^2}=0$ | Cone |
| $\frac{x^2}{a^2}+\frac{y^2}{b^2}-\frac{z^2}{c^2}=1$ | Hyperboloid of one sheet |
| $\frac{z^2}{c^2}-\frac{x^2}{a^2}-\frac{y^2}{b^2}=1$ | Hyperboloid of two sheets |
| $z=\frac{x^2}{a^2}+\frac{y^2}{b^2}$ | Elliptic paraboloid |
| $z=\frac{x^2}{a^2}-\frac{y^2}{b^2}$ | Hyperbolic paraboloid |
| $\frac{x^2}{a^2}+\frac{y^2}{b^2}=1$ | Elliptic cylinder |
| $\frac{x^2}{a^2}-\frac{y^2}{b^2}=1$ | Hyperbolic cylinder |
| $y=ax^2$ | Parabolic cylinder |
| $x^2=a^2$ | Pair of planes |

## Practical Decision Tree

Use this in exams.

### Step 1: Are all three variables squared?

If yes, you probably have one of these:

- Ellipsoid.
- Cone.
- Hyperboloid of one sheet.
- Hyperboloid of two sheets.

Then check signs and the right-hand side.

### Step 2: Are exactly two variables squared and one variable linear?

If yes, you have a paraboloid.

- Same signs: elliptic paraboloid.
- Opposite signs: hyperbolic paraboloid.

Examples:

$$
z=x^2+y^2
$$

is elliptic.

$$
z=x^2-y^2
$$

is hyperbolic.

### Step 3: Is one variable missing?

If one variable is missing, it is usually a cylinder.

Example:

$$
x^2+y^2=4
$$

is a cylinder along the $z$-axis.

The missing variable is the cylinder direction.

### Step 4: Does the equation factor?

If it factors into linear terms, it is probably a degenerate quadric, usually planes.

Example:

$$
x^2-y^2=0
$$

becomes

$$
(x-y)(x+y)=0
$$

So it is a pair of planes.
