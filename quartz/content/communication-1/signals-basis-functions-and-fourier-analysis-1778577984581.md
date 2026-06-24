---
title: "Signals, Basis Functions, and Fourier Analysis"
date: "2026-05-12T09:26:24.581Z"
source: "user-note"
knowledge_type: "user-note"
---

Communication begins with a simple but deep problem: information must be carried by physical signals. A spoken word becomes air pressure, then a microphone voltage. A wireless transmission becomes an electromagnetic wave. A digital file becomes a sequence of voltage levels, light pulses, or radio-frequency changes. In every case, the message is not transmitted as an abstract idea. It is represented by a signal whose form changes as it moves through a communication system. The same information may appear first as an acoustic pressure wave, then as an analog voltage, later as a sequence of numbers, later as a line-coded electrical signal, and eventually again as an analog waveform at the receiver. The physical form changes, but the purpose remains the same: preserve and transfer information with sufficient fidelity.

[Graph: Course reader Figure 1, the Communication 1 topic map, should be placed here to show the transmitter-channel-receiver chain and the way the message changes form.]

A signal is therefore the central object of communication theory. At first, it is natural to think of a signal as a curve drawn against time. A microphone voltage, for example, may be written as

x(t),

where t is time and x(t) is the value of the signal at that instant. If the signal is analog, time varies continuously and the amplitude may also vary continuously. This means that, in principle, the signal has a value at every possible instant. Such a waveform may look like a curve, but for communication theory this visual picture is not enough. We need to know how to describe the signal, how to compare it with other signals, how to decompose it into simpler parts, and how to understand what frequencies it contains.

This is why the first mathematical step is representation. Before a signal can be transmitted, filtered, modulated, sampled, reconstructed, or analyzed, we need a language for saying what it is made of. Fourier analysis provides that language. It says that many signals can be represented in terms of sinusoidal components. The same signal can be viewed in time, where we see how it changes instant by instant, or in frequency, where we see which oscillatory components are present. These are not two different signals. The Fourier series or Fourier transform does not create a new function. It gives an alternative representation of the same function. In the time domain, the function is described by its value at each instant. In the frequency domain, the same function is described by how much of each sinusoidal basis function it contains. The object is unchanged; only the coordinate system has changed.

The idea behind this representation is not unique to Fourier analysis. It is the same idea that appears in linear algebra when a vector is represented using a basis. A vector is not defined by one specific coordinate system. The same vector may be described using different basis vectors, depending on which description is most useful. Signals behave in the same way. A time-domain description tells us how the signal behaves as time passes. A frequency-domain description tells us how much of each sinusoidal pattern is present. Fourier analysis is the change of representation that takes us from one view to the other.

To make this precise, we first need to understand why signals may be treated as vectors. A vector does not have to mean an arrow in two- or three-dimensional physical space. More generally, a vector is an object that can be added to another object of the same kind and multiplied by a scalar while remaining inside the same set of objects. Signals have this structure. If x(t) and y(t) are signals, then

x(t)+y(t)

is also a signal. If c is a scalar, then

cx(t)

is also a signal. Therefore, signals naturally form vector spaces. This viewpoint is essential because it lets us use the ideas of basis, projection, orthogonality, and coordinates for signals.

In digital signal processing, one important signal vector space is denoted by

S.

The elements of S are complete discrete-time signals. A signal in S is an infinite sequence

{y
k
	​

},

where the index k ranges over all integers. Such a signal has the form

…, y
−2
	​

, y
−1
	​

, y
0
	​

, y
1
	​

, y
2
	​

,…

This is an infinite-dimensional signal vector space. It contains whole discrete-time signals, not just short sample blocks. This distinction matters. A finite block of N samples,

x=
	​

x[0]
x[1]
⋮
x[N−1]
	​

	​

,

belongs to

R
N

if the samples are real, or to

C
N

if the samples are complex. Such a vector may be a finite window taken from a signal in S, but it is not the same object as the entire doubly infinite sequence. The full space S is the theoretical space of complete discrete-time signals. The finite space R
N
 or C
N
 is the computational space used when a computer processes a finite block of samples.

A basic signal in S is the discrete-time delta signal, denoted by δ, defined by

δ
k
	​

={
1,
0,
	​

k=0,
k

=0.
	​


A shifted delta signal is zero everywhere except at one chosen integer index. These shifted deltas isolate sample positions. In a finite-dimensional space such as R
N
, the analogous objects are the standard basis vectors

e
0
	​

,e
1
	​

,…,e
N−1
	​

.

Each one has a single nonzero entry. Therefore any finite sample vector can be written as

x=x[0]e
0
	​

+x[1]e
1
	​

+⋯+x[N−1]e
N−1
	​

.

This is a true finite basis expansion. The sample values are the coordinates, and the standard basis vectors identify the sample positions.

For a complete discrete-time signal, one often writes formally

x[k]=
n=−∞
∑
∞
	​

x[n]δ[k−n].

This equation says that the signal can be assembled from shifted deltas weighted by the sample values. However, there is a subtle point. This is an infinite sum. In ordinary algebraic vector-space language, a basis expansion uses only a finite linear combination. Therefore, the shifted deltas form an ordinary algebraic basis for finite-support signals, meaning signals with only finitely many nonzero samples. For general signals in S, the expression is better understood as an infinite coordinate expansion. This is one of the places where signal spaces are richer than the finite-dimensional spaces first encountered in linear algebra.

The reason basis representations are useful is that they let us describe a complicated object through simpler building blocks. In the plane, a vector

v=[
v
1
	​

v
2
	​

	​

]

is usually written using the standard basis vectors

e
1
	​

=[
1
0
	​

],e
2
	​

=[
0
1
	​

].

Then

v=v
1
	​

e
1
	​

+v
2
	​

e
2
	​

.

The coordinates v
1
	​

 and v
2
	​

 tell us how much of each basis direction is present. But another basis could also be used. The vector itself would not change; only its coordinate description would change.

[Graph: Course reader Figure 2, the 2D vector-space visualization with 
i
^
 and 
j
^
	​

, should be placed here.]

A set of basis vectors must satisfy two conditions. First, the vectors must be linearly independent: no vector in the set may be written as a combination of the others. Algebraically, if

c
1
	​

v
1
	​

+c
2
	​

v
2
	​

+⋯+c
k
	​

v
k
	​

=0,

then the only solution must be

c
1
	​

=c
2
	​

=⋯=c
k
	​

=0.

If there were a nonzero solution, then at least one vector could be written in terms of the others, meaning that the set would contain a redundant direction.

Second, the vectors must span the space: every vector in the space must be expressible as a linear combination of them. If

S={v
1
	​

,v
2
	​

,…,v
k
	​

}

is a basis for a space, then every vector w in that space can be written as

w=a
1
	​

v
1
	​

+a
2
	​

v
2
	​

+⋯+a
k
	​

v
k
	​

,

where the coefficients a
1
	​

,a
2
	​

,…,a
k
	​

 scale the basis vectors. Linear independence prevents redundancy. Spanning prevents incompleteness. Together, they make a set of vectors a basis.

The same principle applies to signals. If we describe a finite sample vector using the standard sample-position basis, we are asking how much signal value is present at each sample index. Fourier analysis asks a different question: how much of each sinusoidal pattern is present? The signal does not change. Its coordinates change. Instead of coordinates indexed by time position, we obtain coordinates indexed by frequency.

To make coordinates useful, we need a way to measure how much of one direction is present in another. This is the role of the dot product. The dot product takes two vectors and returns a single number. For

v=[
v
1
	​

	​

v
2
	​

	​

⋯
	​

v
n
	​

	​

],w=
	​

w
1
	​

w
2
	​

⋮
w
n
	​

	​

	​

,

the dot product is

v⋅w=v
1
	​

w
1
	​

+v
2
	​

w
2
	​

+⋯+v
n
	​

w
n
	​

.

This number measures how strongly the two vectors align. If it is large and positive, the vectors point strongly in similar directions. If it is negative, they point partly in opposite directions. If it is zero, the vectors are orthogonal: one has no component in the direction of the other.

Two vectors are orthogonal if their dot product is zero:

v
i
	​

⋅v
j
	​

=0for i

=j.

Orthogonality means that the directions do not interfere with each other. If a vector is measured along one orthogonal direction, that measurement is not contaminated by the components in the other directions. If the basis vectors are also of length one, the basis is called orthonormal.

Projection explains why this matters. In three dimensions, a vector can be decomposed along three mutually perpendicular axes. Suppose

A=A
x
	​

x
^
+A
y
	​

y
^
	​

+A
z
	​

z
^
.

The coordinate A
x
	​

 measures how much of A lies along the x-axis, A
y
	​

 measures how much lies along the y-axis, and A
z
	​

 measures how much lies along the z-axis. These are not three different vectors; they are the three coordinates of the same vector in the chosen basis. Because the axes are orthogonal, each coordinate can be found independently.

[Graph: Use a 3D projection diagram here, matching the left side of Course reader Figure 4. Show a vector A in 3D and its projections A
x
	​

, A
y
	​

, and A
z
	​

 on the three orthogonal axes.]

If x is projected onto a nonzero vector u, the projection coefficient is

a=
u⋅u
x⋅u
	​

.

The numerator measures overlap between x and u. The denominator corrects for the length of u. If u has unit length, then

u⋅u=1,

and the coefficient becomes

a=x⋅u.

Thus, in an orthogonal basis, coefficients are found by projection and by dividing by the squared length of the basis vector. In an orthonormal basis, that squared length is already one, so the coefficient is just the projection inner product.

For complex-valued finite sample vectors, the dot product must be replaced by the complex inner product. If

x,y∈C
N
,

then

⟨x,y⟩=
n=0
∑
N−1
	​

x[n]y
∗
[n],

where y
∗
[n] denotes complex conjugation. The conjugate is not a technical decoration. It is needed so that length and energy behave correctly. With this definition,

⟨x,x⟩=
n=0
∑
N−1
	​

x[n]x
∗
[n]=
n=0
∑
N−1
	​

∣x[n]∣
2
,

which is real and nonnegative. This is the finite signal energy. Without the conjugate, a complex vector could have a “length squared” that is complex or even zero for a nonzero vector, which would destroy the geometry needed for projection.

The imaginary unit j also has a useful geometric meaning. It is often introduced by the algebraic rule

j
2
=−1,

but in signal analysis it is helpful to think of multiplication by j as a 90
∘
 rotation in the complex plane. Multiplying by j rotates a complex quantity by 90
∘
, and multiplying by j
2
=−1 rotates it by 180
∘
. This viewpoint makes Euler’s formula intuitive:

e
jωt
=cos(ωt)+jsin(ωt).

The cosine term lies along the real axis, while the sine term lies along the 90
∘
-shifted imaginary axis. Thus a complex exponential packages two orthogonal sinusoidal directions into one compact expression.

This finite-dimensional viewpoint leads naturally to the Discrete Fourier Transform, or DFT. A computer does not process an entire continuous-time function directly. It processes finite lists of samples. Therefore, it needs a finite-dimensional Fourier tool: a way to take a length-N sample vector and describe it using a finite set of sinusoidal patterns.

For a length-N sample block, the k-th Fourier vector is

v
k
	​

=
	​

1
e
j2πk/N
e
j2πk2/N
⋮
e
j2πk(N−1)/N
	​

	​

.

Its n-th entry is

v
k
	​

[n]=e
j2πkn/N
.

Here n is the sample index, meaning position inside the finite time block. The index k is the frequency index, meaning which sinusoidal pattern is being tested. The case k=0 corresponds to a constant pattern, called the DC component. The case k=1 corresponds to one full cycle across the N-sample block. The case k=2 corresponds to two cycles across the block, and so on. If the samples were taken at sampling frequency f
s
	​

, the frequency spacing between DFT bins is

Δf=
N
f
s
	​

	​

,

so the bin k corresponds to

f
k
	​

=
N
kf
s
	​

	​

,

with the usual interpretation that the upper DFT bins represent negative frequencies.

A subtle but important normalization issue appears here. Each individual complex exponential value

e
j2πkn/N

has magnitude one, because it lies on the unit circle. But the whole vector v
k
	​

 does not have length one. It has N entries, each with magnitude one, so

⟨v
k
	​

,v
k
	​

⟩=
n=0
∑
N−1
	​

∣e
j2πkn/N
∣
2
=
n=0
∑
N−1
	​

1=N.

Therefore,

∥v
k
	​

∥=
N
	​

.

The Fourier vectors are orthogonal, but not orthonormal. They point in independent frequency directions, but their length is 
N
	​

, not one. Their orthogonality follows from the finite sum

n=0
∑
N−1
	​

e
j2π(k−m)n/N
={
N,
0,
	​

k=m,
k

=m.
	​


If k=m, every term in the sum is 1, so the result is N. If k

=m, the terms are equally spaced points around the unit circle. They complete an integer number of rotations and cancel to zero. This is the finite-dimensional version of harmonic orthogonality.

The DFT is obtained by comparing the signal vector with each Fourier vector. Using the complex inner product,

⟨x,v
k
	​

⟩=
n=0
∑
N−1
	​

x[n]v
k
∗
	​

[n].

Since

v
k
	​

[n]=e
j2πkn/N
,

we have

v
k
∗
	​

[n]=e
−j2πkn/N
.

Therefore,

⟨x,v
k
	​

⟩=
n=0
∑
N−1
	​

x[n]e
−j2πkn/N
.

This is the usual DFT formula:

X[k]=
n=0
∑
N−1
	​

x[n]e
−j2πkn/N
.

Thus X[k] is the raw overlap between the sampled signal and the k-th Fourier vector. If the signal strongly contains that frequency pattern, the terms in the sum reinforce and ∣X[k]∣ becomes large. If the pattern is absent, the rotating complex terms cancel and X[k] becomes small or zero.

Because v
k
	​

 is not unit length, the usual DFT output is not the normalized coordinate directly. It is an unnormalized Fourier coordinate. The actual coefficient in the expansion

x=
k=0
∑
N−1
	​

a
k
	​

v
k
	​


is obtained from the projection formula:

a
k
	​

=
⟨v
k
	​

,v
k
	​

⟩
⟨x,v
k
	​

⟩
	​

.

Since

⟨v
k
	​

,v
k
	​

⟩=N,

we get

a
k
	​

=
N
X[k]
	​

.

This is why the inverse DFT contains the factor 1/N:

x[n]=
N
1
	​

k=0
∑
N−1
	​

X[k]e
j2πkn/N
.

The factor 1/N is not arbitrary. It corrects for the fact that the usual Fourier vectors have squared length N. The forward DFT computes raw overlaps. The inverse DFT converts those raw overlaps into the correct reconstruction weights.

For example, suppose

x[n]=Afor all n.

This is a constant signal, so it contains only the DC pattern. For k=0,

X[0]=
n=0
∑
N−1
	​

A=NA.

The DFT gives NA, not A, because it has accumulated the contribution over all N samples. The actual coefficient of the constant basis vector is

N
X[0]
	​

=A.

For k

=0, the complex exponentials complete full rotations and cancel, so

X[k]=0.

Thus the DFT result says that the finite sample block contains only a DC component. Its raw overlap is NA, and its actual coordinate is A.

The magnitude

∣X[k]∣

therefore tells how strongly the finite sample block overlaps with the k-th frequency pattern, up to the chosen normalization convention. The phase

∠X[k]

tells the phase alignment of that component. A large magnitude means that the frequency is strongly present in the finite observation window. A small magnitude means that the pattern is weak or absent.

One may also define normalized Fourier vectors,

u
k
	​

=
N
	​

1
	​

v
k
	​

.

Then

∥u
k
	​

∥=1,

so the basis is orthonormal. In that convention, the Fourier coefficient is directly

X
[k]=⟨x,u
k
	​

⟩=
N
	​

1
	​

X[k],

and reconstruction becomes

x=
k=0
∑
N−1
	​

X
[k]u
k
	​

.

This is the same geometry with a different normalization. The usual engineering convention places all normalization in the inverse transform. The unitary convention splits normalization evenly between the forward and inverse transforms. Both describe the same change of basis.

The DFT is therefore the finite-dimensional version of Fourier analysis. It rewrites a finite sample vector in a frequency basis. Its results are not mysterious new quantities; they are frequency-domain overlaps, with magnitude and phase, scaled according to the normalization convention. This finite-dimensional picture prepares the same idea in a more general setting: continuous-time signals are also vectors, but now the vectors are functions.

In a function space, basis vectors become basis functions. A signal may be represented as

x(t)=
i
∑
	​

a
i
	​

ϕ
i
	​

(t),

where ϕ
i
	​

(t) are basis functions and a
i
	​

 are coefficients. Basis functions need not be sinusoidal. A Taylor series, for example, uses polynomial basis functions:

f(t)=a
0
	​

+a
1
	​

t+a
2
	​

t
2
+a
3
	​

t
3
+⋯=
n=0
∑
∞
	​

a
n
	​

t
n
.

Here the basis functions are

1, t, t
2
, t
3
,…

[Graph: Course reader Figure 3, showing a function decomposed into a sum of five basis functions, should be placed here.]

Fourier analysis chooses a different family:

sin(ωt),cos(ωt),e
jωt
.

This choice is made because communication systems are naturally described in terms of frequency. Filters pass some frequencies and suppress others. Channels have bandwidth. Antennas operate over frequency ranges. Modulation shifts information to different frequency bands. Therefore, a basis that reveals frequency content is especially useful.

To project one function onto another, the finite sum in the inner product becomes an integral:

⟨f,g⟩=∫
t
1
	​

t
2
	​

	​

f(t)g
∗
(t)dt.

This is the continuous analogue of the dot product. Instead of multiplying corresponding vector entries and summing, we multiply corresponding function values and integrate. A function space equipped with such an inner product, together with the appropriate completeness property, is called a Hilbert space. For the present purpose, the essential idea is that functions can be treated like vectors: they can be projected onto basis functions, and coefficients can be found by inner products.

The analogy with ordinary three-dimensional projection is direct. In three dimensions, the coordinate of a vector 
A
 along the x-axis is found by projecting 
A
 onto the unit vector 
x
^
:

A
x
	​

=
A
⋅
x
^
.

The dot product measures how much of 
A
 lies in the 
x
^
 direction. Because the x, y, and z axes are mutually orthogonal, projection onto one axis does not pick up components from the other axes.

In a Hilbert space of functions, the “axes” are no longer physical coordinate axes. They are basis functions. For a periodic signal, these basis functions are often chosen as complex exponentials,

e
jkω
0
	​

t
,

or equivalently as sine and cosine functions. The Fourier coefficient

c
k
	​

=
T
1
	​

∫
0
T
	​

x(t)e
−jkω
0
	​

t
dt

is the function-space version of a coordinate projection. The finite dot product has become an integral over time. The basis vector 
x
^
 has become the basis function e
jkω
0
	​

t
. The coordinate A
x
	​

 has become the Fourier coefficient c
k
	​

. The integer k selects which orthogonal function-axis, or harmonic direction, is being measured.

[Graph: Course reader Figure 4, “From 3D Axes to Function Axes,” should be placed here. It should show the 3D projection A
x
	​

=
A
⋅
x
^
 next to the function projection c
k
	​

=
T
1
	​

∫
0
T
	​

x(t)e
−jkω
0
	​

t
dt.]

A set of basis functions {ϕ
k
	​

(t)} is orthogonal on the interval [t
1
	​

,t
2
	​

] if

∫
t
1
	​

t
2
	​

	​

ϕ
i
	​

(t)ϕ
j
∗
	​

(t)dt=0for i

=j.

The squared length, or energy, of one basis function is

λ
k
	​

=∫
t
1
	​

t
2
	​

	​

∣ϕ
k
	​

(t)∣
2
dt.

If

λ
k
	​

=1

for every k, the basis is orthonormal.

Suppose a signal can be represented as

x(t)=
k
∑
	​

a
k
	​

ϕ
k
	​

(t).

To find a
m
	​

, multiply both sides by ϕ
m
∗
	​

(t) and integrate:

∫
t
1
	​

t
2
	​

	​

x(t)ϕ
m
∗
	​

(t)dt=∫
t
1
	​

t
2
	​

	​

(
k
∑
	​

a
k
	​

ϕ
k
	​

(t))ϕ
m
∗
	​

(t)dt.

By linearity,

∫
t
1
	​

t
2
	​

	​

x(t)ϕ
m
∗
	​

(t)dt=
k
∑
	​

a
k
	​

∫
t
1
	​

t
2
	​

	​

ϕ
k
	​

(t)ϕ
m
∗
	​

(t)dt.

Orthogonality removes every term except the one with k=m:

∫
t
1
	​

t
2
	​

	​

x(t)ϕ
m
∗
	​

(t)dt=a
m
	​

∫
t
1
	​

t
2
	​

	​

∣ϕ
m
	​

(t)∣
2
dt.

Using

λ
m
	​

=∫
t
1
	​

t
2
	​

	​

∣ϕ
m
	​

(t)∣
2
dt,

we obtain

a
m
	​

=
λ
m
	​

1
	​

∫
t
1
	​

t
2
	​

	​

ϕ
m
∗
	​

(t)x(t)dt.

This is the general projection formula for orthogonal basis functions. If the basis is orthonormal, then λ
m
	​

=1, and

a
m
	​

=∫
t
1
	​

t
2
	​

	​

ϕ
m
∗
	​

(t)x(t)dt.

This is the reason Fourier coefficients are found by multiplying by a basis function and integrating. The integral is not a memorized trick; it is projection in a function space.

The projection idea also has a direct area interpretation. When a signal is multiplied by a basis function and integrated, the integral measures the net signed area of their product. If the signal truly contains that basis function, the product has a nonzero net area. If the basis function does not match the signal’s structure, positive and negative areas cancel. This is the functional version of saying that one vector has zero projection onto an orthogonal direction.

For example, suppose

x(t)=2sin(t)+0.5cos(t).

If this signal is projected onto the correct basis functions, sin(t) and cos(t), the coefficients are significant: the projections recover the weights 2 and 0.5. The basis functions are actually present in the signal. But if the same signal is projected onto the wrong basis functions, such as sin(2t) and cos(2t), the products oscillate in such a way that the positive and negative areas cancel. The resulting coefficients are zero or nearly zero. This is exactly what orthogonality means in practice: a basis function that is not present in the signal has no surviving projection.

[Graph: Course reader Figure 5, correct basis and wrong basis projection example, should be placed here. Use panel (a) for the correct basis sin(t), cos(t), and panel (b) for the wrong basis sin(2t), cos(2t), where the shaded areas cancel.]

This area-cancellation picture is one of the most important intuitions in Fourier analysis. A Fourier coefficient is not a mysterious number produced by a formula. It is the signed area of a comparison. The signal is multiplied by a candidate basis function, and the integral asks whether the product has a surviving average contribution or whether the oscillations cancel out.

For periodic signals, the natural Fourier basis functions are complex exponentials,

e
jkω
0
	​

t
,

where

ω
0
	​

=
T
2π
	​


is the fundamental angular frequency of a signal with period T. The integer k selects the harmonic. A periodic signal satisfies

x(t)=x(t+T),

and it can be represented as

x(t)=
k=−∞
∑
∞
	​

c
k
	​

e
jkω
0
	​

t
.

Here each exponential e
jkω
0
	​

t
 serves as a basis function for the space of signals with period T. These exponentials are orthogonal over one period:

∫
0
T
	​

e
jmω
0
	​

t
e
−jnω
0
	​

t
dt=0m

=n.

To see why, combine the exponentials:

e
jmω
0
	​

t
e
−jnω
0
	​

t
=e
j(m−n)ω
0
	​

t
.

If m=n, the exponent is zero and the integral becomes

∫
0
T
	​

1dt=T.

If m

=n, then

∫
0
T
	​

e
j(m−n)ω
0
	​

t
dt=[
j(m−n)ω
0
	​

e
j(m−n)ω
0
	​

t
	​

]
0
T
	​

.

Since ω
0
	​

T=2π,

e
j(m−n)ω
0
	​

T
=e
j(m−n)2π
=1,

so the numerator becomes 1−1=0, and the integral is zero. Therefore different harmonics are orthogonal.

This orthogonality is what allows a Fourier coefficient to isolate one frequency component. To find c
m
	​

, multiply the Fourier series by e
−jmω
0
	​

t
 and integrate over one period:

∫
0
T
	​

x(t)e
−jmω
0
	​

t
dt=∫
0
T
	​

(
k=−∞
∑
∞
	​

c
k
	​

e
jkω
0
	​

t
)e
−jmω
0
	​

t
dt.

Move the summation outside the integral:

∫
0
T
	​

x(t)e
−jmω
0
	​

t
dt=
k=−∞
∑
∞
	​

c
k
	​

∫
0
T
	​

e
j(k−m)ω
0
	​

t
dt.

All terms disappear except the one with k=m. Therefore,

∫
0
T
	​

x(t)e
−jmω
0
	​

t
dt=c
m
	​

T.

Solving for c
m
	​

 gives

c
m
	​

=
T
1
	​

∫
0
T
	​

x(t)e
−jmω
0
	​

t
dt.

The factor 1/T appears because the energy of e
jmω
0
	​

t
 over one period is T. It is exactly the normalization factor from the general projection formula.

Using Euler’s formula,

e
jθ
=cosθ+jsinθ,

the same periodic signal can also be written as a sine-cosine Fourier series:

x(t)=
2
a
0
	​

	​

+
n=1
∑
∞
	​

[a
n
	​

cos(nω
0
	​

t)+b
n
	​

sin(nω
0
	​

t)].

The term a
0
	​

/2 is the DC component, or average value. The coefficients are

a
n
	​

=
T
2
	​

∫
0
T
	​

x(t)cos(nω
0
	​

t)dt,
b
n
	​

=
T
2
	​

∫
0
T
	​

x(t)sin(nω
0
	​

t)dt.

The factor 2/T appears because the energy of sin(nω
0
	​

t) or cos(nω
0
	​

t) over one period is T/2. Again, the coefficient formulas are projection formulas.

The sine and cosine functions are also orthogonal over a full period when their frequencies are harmonics of the fundamental frequency. This is crucial because it explains why the sine-cosine Fourier series can isolate each harmonic independently.

Let

ω
0
	​

=
T
2π
	​

.

Consider two sine functions with harmonic indices n and k:

sin(nω
0
	​

t)andsin(kω
0
	​

t).

To test whether they are orthogonal, compute

∫
0
T
	​

sin(nω
0
	​

t)sin(kω
0
	​

t)dt.

Using the identity

sinAsinB=
2
1
	​

[cos(A−B)−cos(A+B)],

we get

∫
0
T
	​

sin(nω
0
	​

t)sin(kω
0
	​

t)dt=
2
1
	​

∫
0
T
	​

[cos((n−k)ω
0
	​

t)−cos((n+k)ω
0
	​

t)]dt.

If n

=k, both cosine terms complete an integer number of cycles over 0≤t≤T, so their integrals vanish. Therefore,

∫
0
T
	​

sin(nω
0
	​

t)sin(kω
0
	​

t)dt=0n

=k.

If n=k, then

sin(nω
0
	​

t)sin(nω
0
	​

t)=sin
2
(nω
0
	​

t),

and over one full period the average value of sin
2
 is 1/2. Therefore,

∫
0
T
	​

sin
2
(nω
0
	​

t)dt=
2
T
	​

.

The same reasoning applies to cosine functions. Using

cosAcosB=
2
1
	​

[cos(A−B)+cos(A+B)],

we obtain

∫
0
T
	​

cos(nω
0
	​

t)cos(kω
0
	​

t)dt=0n

=k,

and

∫
0
T
	​

cos
2
(nω
0
	​

t)dt=
2
T
	​

.

Finally, sine and cosine functions are mutually orthogonal. Using

sinAcosB=
2
1
	​

[sin(A+B)+sin(A−B)],

we find that

∫
0
T
	​

sin(nω
0
	​

t)cos(kω
0
	​

t)dt=0

for harmonic frequencies over a full period. The sine-cosine products oscillate symmetrically, so the positive and negative areas cancel.

This proves the essential trigonometric orthogonality used by Fourier series. Different harmonics do not interfere with one another under the integral. The coefficient of one harmonic can therefore be extracted without contamination from the others.

The quadrature form of the Fourier series writes the same idea over a symmetric interval. Let the period be

T=2L.

Then a periodic signal may be written as

f(t)=
2
a
0
	​

	​

+
n=1
∑
∞
	​

[a
n
	​

cos(
L
nπt
	​

)+b
n
	​

sin(
L
nπt
	​

)].

Here the basis functions are

cos(
L
nπt
	​

)andsin(
L
nπt
	​

),

and the fundamental angular frequency is consistent with

ω
0
	​

=
T
2π
	​

=
L
π
	​

.

The coefficients are obtained by projection over the symmetric interval [−L,L]:

a
n
	​

=
L
1
	​

∫
−L
L
	​

f(t)cos(
L
nπt
	​

)dt,
b
n
	​

=
L
1
	​

∫
−L
L
	​

f(t)sin(
L
nπt
	​

)dt.

The factor 1/L appears because the energy of each sine or cosine basis function over [−L,L] is L. The DC component requires careful notation. The actual DC value, meaning the average value of the signal over one period, is

2
a
0
	​

	​

=
T
1
	​

∫
−L
L
	​

f(t)dt.

Since T=2L, this is equivalent to

a
0
	​

=
L
1
	​

∫
−L
L
	​

f(t)dt.

This distinction matters. The term that appears in the Fourier series is a
0
	​

/2, which is the average level of the signal. The symbol a
0
	​

 is twice that value in the classical notation.

The quadrature form is especially useful for practical calculation. Periodic signals such as square, rectangular, and sawtooth waves often have symmetry. If a function is even, its sine coefficients vanish because an even function multiplied by an odd sine function gives an odd product whose integral over [−L,L] is zero. If a function is odd, its cosine coefficients vanish because an odd function multiplied by an even cosine function gives an odd product. This is why symmetry can greatly reduce the work needed to calculate Fourier coefficients.

[Graph: Course reader Mini-lab/Fourier coefficient figure may be placed here. Use it to show how manually chosen a
n
	​

 and b
n
	​

 coefficients reconstruct different periodic shapes.]

The degree to which an oscillating wave with frequency ω is represented in a signal can be calculated by finding the area under the graph after multiplication. In the Fourier series equations, this area is the overlap between the signal and a candidate sinusoidal function. Each frequency has its own integral result, and that result becomes the coefficient, or weight, of the sinusoid in the reconstructed signal. The actual area of the candidate sinusoid itself is not the point. The important quantity is the computed overlap area after the signal and the sinusoid are multiplied.

[Graph: Course reader Figures 7–10 should be placed here. These show a square wave multiplied by sinusoids of different frequencies and the shaded net-area/cancellation idea.]

Fourier series applies to periodic signals. The spectrum of a periodic signal consists of discrete harmonics: integer multiples of the fundamental frequency. Non-periodic signals require the Fourier transform. The idea remains the same, but the frequency variable becomes continuous. Instead of a sum over harmonics, we use an integral over all frequencies.

There are two common notations for the Fourier transform. Using angular frequency ω, measured in radians per second, the transform is written as

F(ω)=∫
−∞
∞
	​

f(t)e
−jωt
dt.

Using ordinary frequency f, measured in hertz, the same idea is written as

X(f)=∫
−∞
∞
	​

x(t)e
−j2πft
dt.

The two frequency variables are related by

ω=2πf.

Thus e
−jωt
 and e
−j2πft
 play the same role, but they use different frequency units. In angular-frequency notation, the inverse transform is usually written with a normalization factor:

f(t)=
2π
1
	​

∫
−∞
∞
	​

F(ω)e
jωt
dω.

In hertz notation, the inverse transform is commonly written as

x(t)=∫
−∞
∞
	​

X(f)e
j2πft
df.

Both forms express the same principle: the Fourier transform is the continuous-frequency version of the Fourier series. It gives the spectrum of a non-periodic signal. The function F(ω) or X(f) tells how the signal is represented in terms of complex exponentials at each frequency.

There is also a useful geometric way to understand what the Fourier transform means. At one chosen frequency f, the Fourier transform compares the signal with two reference waves at that frequency: a cosine wave and a sine wave. This becomes clear from Euler’s formula,

e
−j2πft
=cos(2πft)−jsin(2πft).

Substituting this into the Fourier transform gives

X(f)=∫
−∞
∞
	​

x(t)cos(2πft)dt−j∫
−∞
∞
	​

x(t)sin(2πft)dt.

The first integral is the net area obtained after multiplying the signal by a cosine wave at frequency f. This is the real component of X(f). Geometrically, it is the horizontal side, or base, of a right triangle in the complex plane. The second integral is the net area obtained after multiplying the signal by a sine wave at the same frequency. Because of the convention e
−j2πft
, this sine contribution appears with a minus sign in the imaginary part. Geometrically, it still gives the vertical side, or height, of the triangle, with its sign determining whether the height points upward or downward in the complex plane.

So for each frequency f, the Fourier transform produces one complex number. That complex number can be drawn as an arrow. The horizontal component is the cosine overlap. The vertical component is the sine overlap, with the sign determined by the Fourier convention. The magnitude

∣X(f)∣

is the length of this arrow. In the triangle picture, it is the hypotenuse. It combines the cosine area and sine area through the Pythagorean theorem:

∣X(f)∣=
(cosine area)
2
+(sine area)
2
	​

.

The magnitude therefore tells how strongly the signal contains that frequency overall, without caring whether the contribution appears mainly in the cosine direction or mainly in the sine direction.

The phase

∠X(f)

is the angle of the same arrow. It tells how the frequency component is aligned between the cosine and sine directions. In other words, phase describes the relative size and sign of the two net areas. If the phase is 0
∘
, the sine contribution is zero, so the triangle has no height and the frequency component lies entirely along the cosine direction. If the phase is 45
∘
 or −45
∘
, the absolute values of the cosine and sine contributions are equal, giving a 45
∘
-45
∘
-90
∘
 triangle. A positive or negative phase indicates on which side of the complex plane the vertical component lies. Thus phase is not a mysterious extra quantity; it is the angle that records how the cosine and sine overlaps combine.

This triangle picture makes the Fourier transform less abstract. At each frequency, the transform asks two questions at once: how much does the signal resemble the cosine at that frequency, and how much does it resemble the sine at that frequency? The real and imaginary parts store those two perpendicular measurements. The magnitude gives their combined size. The phase gives their angular balance.

[Graph: Insert a custom geometric figure here. It should show cosine overlap as the horizontal side, sine overlap as the vertical side, magnitude as the hypotenuse, and phase as the angle.]

The same idea can be shown through shaded areas. When a square wave is multiplied by a sinusoid of a matching frequency, the product has a nonzero net area. That nonzero area means the square wave contains a component at that frequency. If the square wave is multiplied by a sinusoid whose frequency does not match a component of the signal, the product oscillates so that positive and negative shaded regions cancel. The integral becomes small or zero.

[Graph: Course reader Figures 7–10 should be placed here. Figure 7 shows a square wave multiplied by a 1 Hz sinusoid with nonzero shaded net area. Figures 8–10 show the same area-correlation idea at different frequencies, including the cancellation case.]

A useful example is a single rectangular pulse,

w(t)={
1,
0,
	​

∣t∣<
2
T
	​

,
otherwise.
	​


This is not a periodic square wave. It occurs once and does not repeat in time. Therefore, it is represented by a Fourier transform, not by a Fourier series. Using the hertz-frequency convention, its Fourier transform is

W(f)=∫
−∞
∞
	​

w(t)e
−j2πft
dt.

Since w(t)=1 only on (−T/2,T/2),

W(f)=∫
−T/2
T/2
	​

e
−j2πft
dt.

Integrating gives

W(f)=[
−j2πf
e
−j2πft
	​

]
−T/2
T/2
	​

.

Therefore,

W(f)=
−j2πf
e
−jπfT
−e
jπfT
	​

.

Using

e
−jα
−e
jα
=−2jsinα,

we obtain

W(f)=
−j2πf
−2jsin(πfT)
	​

=
πf
sin(πfT)
	​

.

Multiplying and dividing by T,

W(f)=T
πfT
sin(πfT)
	​

.

With

sinc(x)=
πx
sin(πx)
	​

,

this becomes

W(f)=Tsinc(fT).

Thus a rectangular pulse in time has a sinc-shaped spectrum. The pulse is localized in time, but its spectrum spreads across frequency. This example is important because it shows that sharp time-domain features require many frequency components. A sudden edge in time cannot be described by only one sinusoid. It needs a wide combination of sinusoidal basis functions.

[Graph: Course reader Figure 11 should be placed here. It shows a single square pulse and its Fourier transform, which has a sinc-like magnitude spectrum.]

Several properties make the Fourier transform especially useful. Linearity means that the transform of a sum is the sum of the transforms:

F{ax(t)+by(t)}=aX(f)+bY(f).

This matters because communication signals are often built by adding components, and linearity lets their spectra be handled component by component.

Time shifting changes phase but not magnitude. If

x(t)⟷X(f),

then

x(t−t
0
	​

)⟷X(f)e
−j2πft
0
	​

.

A delay therefore appears in the frequency domain as a phase factor. The magnitude spectrum remains unchanged. This is physically sensible: delaying a signal does not change which frequencies it contains, but it changes their phase alignment.

Frequency shifting is equally important. Multiplying a signal by a complex exponential shifts its spectrum:

x(t)e
j2πf
0
	​

t
⟷X(f−f
0
	​

).

This is the mathematical basis of modulation: multiplying by an oscillation moves spectral content to another frequency range.

Time scaling changes the width of the spectrum. If

x(t)⟷X(f),

then

x(at)⟷
∣a∣
1
	​

X(
a
f
	​

).

Compressing a signal in time spreads it in frequency, while stretching a signal in time compresses it in frequency. This is another expression of the time-frequency trade-off.

Differentiation in time becomes multiplication by frequency. If

x(t)⟷X(f),

then

dt
d
	​

x(t)⟷j2πfX(f).

This property explains why rapid changes in time correspond to stronger high-frequency content. A derivative emphasizes fast variations, and in the frequency domain this appears as multiplication by a factor proportional to frequency.

Convolution is another central property. If two signals are convolved in time,

z(t)=x(t)∗h(t),

then their Fourier transforms multiply:

Z(f)=X(f)H(f).

This property explains why filters are described by frequency responses. A linear time-invariant system with impulse response h(t) modifies the spectrum of an input x(t) by multiplication with H(f). Frequencies for which H(f) is large pass strongly; frequencies for which H(f) is small are attenuated.

Multiplication in time corresponds to convolution in frequency:

x(t)y(t)⟷X(f)∗Y(f).

This is the dual of the previous property and is fundamental later when sampled or modulated waveforms are analyzed. Multiplying by a sinusoid, for example, does not merely change the amplitude of a signal; it shifts and spreads spectral content according to this multiplication-convolution relationship.

The complete chain is now visible. Signals can be treated as vector-space objects. Finite sample windows belong to R
N
 or C
N
, while complete discrete-time signals belong to the infinite-dimensional signal vector space S. Basis representations allow the same object to be described in different coordinate systems. Orthogonality makes projections independent. Inner products measure overlap. The 3D projection picture explains why coefficients are coordinates along independent directions, and Hilbert space extends that same idea to functions. In finite dimensions, the DFT rewrites a sample block in terms of finite sinusoidal patterns. In function spaces, Fourier series and Fourier transforms rewrite signals in terms of sinusoidal basis functions. The sine and cosine functions are orthogonal over a period when their frequencies are harmonics of the fundamental frequency, which is why each harmonic coefficient can be isolated by integration. The Fourier representation is therefore not a different signal; it is an alternative representation of the same signal, chosen because frequency content is the language in which communication systems, channels, filtering, and modulation become understandable.