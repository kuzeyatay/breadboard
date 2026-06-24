---
title: "Amplitude Modulation"
date: "2026-06-20T12:43:16.325Z"
source: "user-note"
knowledge_type: "user-note"
---

# Amplitude Modulation: Signal Formula, Modulation Percentage, Efficiency, Spectrum, and Detection

Amplitude modulation appears at this point in the course because we have already learned how to describe signals in time and frequency, and we have already seen that information signals often start as **baseband** signals. A baseband signal is a signal whose spectrum is concentrated near $f=0$. For example, an audio message from a microphone is a low-frequency waveform. It is not naturally located around a high radio frequency.

![pasted 1781959905498](/communication-1/assets/pasted-1781959905498.png)

A physical wireless channel often requires a signal to be transmitted around a much higher frequency. Antennas are more practical at radio frequencies, and different users can be separated by assigning them different carrier-frequency bands. Therefore, instead of transmitting the message directly around $0\text{ Hz}$, we shift it to a band around a carrier frequency $f_c$. A signal whose spectrum is concentrated around a nonzero carrier frequency is called a **bandpass** signal.

![pasted 1781959919938](/communication-1/assets/pasted-1781959919938.png)

The process of moving a baseband signal to a band around a carrier is called **modulation**. In amplitude modulation, the information is placed in the amplitude of a high-frequency carrier wave. The carrier itself is usually written as

$$
\cos(\omega_c t),
$$

where

$$
\omega_c = 2\pi f_c.
$$

Here $f_c$ is the carrier frequency in hertz, and $\omega_c$ is the angular carrier frequency in radians per second.

The essential idea is simple: the message $m(t)$ changes the amplitude of the carrier. The carrier oscillates quickly, while the message changes slowly. The receiver then tries to recover the slow amplitude variation.

## 1. Up-conversion and the role of the carrier

The mathematical operation that moves a signal in frequency is multiplication by a sinusoid. If a baseband signal is multiplied by a local oscillator signal, such as

$$
\cos(\omega_c t),
$$

then its spectrum is copied to frequencies around $+f_c$ and $-f_c$. This is the basis of up-conversion.

![pasted 1781959937550](/communication-1/assets/pasted-1781959937550.png)

The reason multiplication shifts frequencies comes from the identity

$$
\cos(\alpha)\cos(\beta)=\frac{1}{2}\cos(\alpha+\beta)+\frac{1}{2}\cos(\alpha-\beta).
$$

If a low-frequency cosine is multiplied by a high-frequency cosine, the result contains a sum frequency and a difference frequency. For example,

$$
\cos(2\pi f_m t)\cos(2\pi f_c t)=\frac{1}{2}\cos(2\pi(f_c+f_m)t)+\frac{1}{2}\cos(2\pi(f_c-f_m)t).
$$

So a message tone at $f_m$ is moved to two frequencies around the carrier:

$$
f_c+f_m
$$

and

$$
f_c-f_m.
$$

These two frequency components are called **sidebands**.

## 2. The AM signal formula

Let $m(t)$ be the message signal. In this course, $m(t)$ is often a sinusoidal tone, for example

$$
m(t)=D\cos(\omega_m t),
$$

or

$$
m(t)=D\sin(\omega_m t),
$$

where

$$
\omega_m=2\pi f_m.
$$

The factor $D$ is very important. It controls how strongly the message changes the carrier amplitude. Without this factor, using $m(t)=\cos(\omega_m t)$ would automatically produce $100\%$ modulation. Many exam questions require you to calculate $D$ from a graph, from an efficiency value, or from a spectrum.

In ordinary AM, also called AM with carrier, we first form the envelope signal

$$
g(t)=A_c[1+m(t)].
$$

Then we multiply this envelope by the carrier:

$$
s(t)=g(t)\cos(\omega_c t).
$$

Therefore the standard AM signal is

$$
\boxed{s(t)=A_c[1+m(t)]\cos(\omega_c t).}
$$

Here:

$$
A_c
$$

is the carrier amplitude,

$$
m(t)
$$

is the normalized message signal,

$$
g(t)=A_c[1+m(t)]
$$

is the envelope, and

$$
s(t)
$$

is the transmitted AM signal.

For a sinusoidal message,

$$
m(t)=D\cos(\omega_m t),
$$

the AM signal becomes

$$
\boxed{s(t)=A_c[1+D\cos(\omega_m t)]\cos(\omega_c t).}
$$

Using hertz instead of angular frequency,

$$
\boxed{s(t)=A_c[1+D\cos(2\pi f_m t)]\cos(2\pi f_c t).}
$$

This is the main AM formula. The message frequency $f_m$ belongs inside the slowly varying bracket. The carrier frequency $f_c$ belongs in the fast cosine outside the bracket. Swapping these two is a serious conceptual error because it means the message and the carrier have been confused.

## 3. The AM envelope and $A_{\max}$, $A_{\min}$

The carrier $\cos(\omega_c t)$ oscillates very quickly. The factor

$$
A_c[1+D\cos(\omega_m t)]
$$

changes slowly when $f_m\ll f_c$. The outline traced by the positive and negative peaks of the carrier is called the **envelope**.

![pasted 1781959972385](/communication-1/assets/pasted-1781959972385.png)

For the sinusoidal AM signal

$$
s(t)=A_c[1+D\cos(\omega_m t)]\cos(\omega_c t),
$$

the maximum envelope amplitude occurs when

$$
\cos(\omega_m t)=1.
$$

Then

$$
A_{\max}=A_c(1+D).
$$

The minimum envelope amplitude occurs when

$$
\cos(\omega_m t)=-1.
$$

Then

$$
A_{\min}=A_c(1-D).
$$

So

$$
\boxed{A_{\max}=A_c(1+D)}
$$

and

$$
\boxed{A_{\min}=A_c(1-D).}
$$

These two equations are extremely useful because the exam often gives an AM waveform and expects you to extract $A_c$, $D$, and the modulation percentage.

Adding the two equations gives

$$
A_{\max}+A_{\min}=A_c(1+D)+A_c(1-D)=2A_c.
$$

Therefore

$$
\boxed{A_c=\frac{A_{\max}+A_{\min}}{2}.}
$$

Subtracting gives

$$
A_{\max}-A_{\min}=A_c(1+D)-A_c(1-D)=2A_cD.
$$

So

$$
D=\frac{A_{\max}-A_{\min}}{2A_c}.
$$

Since

$$
2A_c=A_{\max}+A_{\min},
$$

we also get

$$
\boxed{D=\frac{A_{\max}-A_{\min}}{A_{\max}+A_{\min}}.}
$$

For example, if a waveform has

$$
A_{\max}=130\text{ V}
$$

and

$$
A_{\min}=70\text{ V},
$$

then

$$
A_c=\frac{130+70}{2}=100\text{ V},
$$

and

$$
D=\frac{130-70}{130+70}=\frac{60}{200}=0.3.
$$

So the modulation depth is $D=0.3$, meaning $30\%$ modulation.

## 4. Percentage of modulation

The **percentage of modulation** measures how much the carrier amplitude is varied by the message. For a general normalized message $m(t)$, the course defines

$$
\boxed{\%\text{ modulation}=\frac{\max(m(t))-\min(m(t))}{2}\cdot100\%.}
$$

For a sinusoidal message

$$
m(t)=D\cos(\omega_m t),
$$

we have

$$
\max(m(t))=D
$$

and

$$
\min(m(t))=-D.
$$

Therefore

$$
\%\text{ modulation}=\frac{D-(-D)}{2}\cdot100\%=D\cdot100\%.
$$

So, for sinusoidal AM,

$$
\boxed{\%\text{ modulation}=D\cdot100\%.}
$$

If

$$
D=0.6,
$$

then the modulation percentage is

$$
60\%.
$$

If

$$
D=1,
$$

then the modulation percentage is

$$
100\%.
$$

If

$$
D=2,
$$

then the modulation percentage is

$$
200\%.
$$

Using the envelope quantities, we can also write

$$
\boxed{\%\text{ modulation}=\frac{A_{\max}-A_{\min}}{2A_c}\cdot100\%.}
$$

Since

$$
2A_c=A_{\max}+A_{\min},
$$

this is equivalent to

$$
\boxed{\%\text{ modulation}=\frac{A_{\max}-A_{\min}}{A_{\max}+A_{\min}}\cdot100\%.}
$$

This is the most direct formula when the question gives a time-domain AM waveform.

There is also a distinction between positive and negative modulation. The positive modulation is

$$
\boxed{\%\text{ positive modulation}=\max(m(t))\cdot100\%,}
$$

and the negative modulation is

$$
\boxed{\%\text{ negative modulation}=-\min(m(t))\cdot100\%.}
$$

For a symmetric sinusoid, these are the same. For a non-symmetric message, they can be different.

## 5. Under-modulation, $100\%$ modulation, and overmodulation

For

$$
s(t)=A_c[1+D\cos(\omega_m t)]\cos(\omega_c t),
$$

the value of $D$ determines whether the envelope stays positive.

If

$$
0<D<1,
$$

then

$$
1+D\cos(\omega_m t)>0
$$

for all time. The envelope never crosses zero. This is the normal case for simple envelope detection.

If

$$
D=1,
$$

then the minimum envelope value is

$$
A_{\min}=A_c(1-1)=0.
$$

The envelope just touches zero. This is $100\%$ modulation.

If

$$
D>1,
$$

then

$$
1+D\cos(\omega_m t)
$$

becomes negative during part of the message cycle. This is called **overmodulation**.

Overmodulation is not mathematically impossible. You can still write the signal formula. However, a simple envelope detector cannot recover the message correctly because the envelope crosses zero and changes sign. The detector follows the magnitude-like outline rather than the signed message, so the recovered waveform is distorted.

Therefore a better statement is not “above $100\%$ modulation is impossible.” A better statement is:

For ordinary envelope detection, the negative modulation must stay below or equal to $100\%$. If the envelope crosses zero, a product detector is needed for correct recovery.

## 6. Modulation efficiency

The modulation percentage tells us how strongly the message varies the carrier amplitude. It does not directly tell us how efficiently power is used.

Ordinary AM contains a carrier component. The carrier is useful because it makes envelope detection simple, but it does not itself carry the message. The information is contained in the sidebands. Therefore, ordinary AM spends part of its power on something that helps detection but does not carry information.

The **modulation efficiency** is the percentage of transmitted power that is used to convey information. For ordinary AM, the course formula is

$$
\boxed{\eta_{\text{mod}}=\frac{\langle m^2(t)\rangle}{1+\langle m^2(t)\rangle}\cdot100\%.}
$$

Here

$$
\langle m^2(t)\rangle
$$

means the time average of $m^2(t)$. It is not the maximum value. It is the average over a period.

For a sinusoidal message

$$
m(t)=D\cos(\omega_m t),
$$

we have

$$
m^2(t)=D^2\cos^2(\omega_m t).
$$

The time average of $\cos^2(\omega_m t)$ is

$$
\langle \cos^2(\omega_m t)\rangle=\frac{1}{2}.
$$

Therefore

$$
\langle m^2(t)\rangle=D^2\cdot\frac{1}{2}=\frac{D^2}{2}.
$$

Substituting into the efficiency formula gives

$$
\boxed{\eta_{\text{mod}}=\frac{D^2/2}{1+D^2/2}\cdot100\%.}
$$

This is one of the most important formulas in this section.

It also shows an important trap: modulation percentage and modulation efficiency are not the same thing.

For example, if the AM signal is $60\%$ modulated, then

$$
D=0.6.
$$

So

$$
\frac{D^2}{2}=\frac{0.6^2}{2}=\frac{0.36}{2}=0.18.
$$

Then

$$
\eta_{\text{mod}}=\frac{0.18}{1+0.18}\cdot100\%=\frac{0.18}{1.18}\cdot100\%\approx15.2\%.
$$

Thus $60\%$ modulation gives only about $15.2\%$ modulation efficiency for a sinusoidal message.

For $100\%$ sinusoidal AM,

$$
D=1.
$$

Then

$$
\frac{D^2}{2}=\frac{1}{2}.
$$

So

$$
\eta_{\text{mod}}=\frac{1/2}{1+1/2}\cdot100\%=\frac{1/2}{3/2}\cdot100\%=\frac{1}{3}\cdot100\%\approx33.3\%.
$$

Therefore, even a fully modulated sinusoidal AM signal uses only one third of its transmitted power for the information-bearing sidebands. The rest is in the carrier.

## 7. Maximum possible AM efficiency

For sinusoidal $100\%$ AM, the efficiency is $33.3\%$. However, this is not the absolute maximum possible efficiency of ordinary AM.

The efficiency formula is

$$
\eta_{\text{mod}}=\frac{\langle m^2(t)\rangle}{1+\langle m^2(t)\rangle}\cdot100\%.
$$

If the AM signal is not overmodulated, then roughly

$$
-1\le m(t)\le 1.
$$

For a sinusoid with amplitude $1$,

$$
\langle m^2(t)\rangle=\frac{1}{2}.
$$

But for a square-wave message that alternates between $+1$ and $-1$,

$$
m^2(t)=1
$$

at every time. Therefore

$$
\langle m^2(t)\rangle=1.
$$

Then

$$
\eta_{\text{mod}}=\frac{1}{1+1}\cdot100\%=50\%.
$$

So the maximum possible efficiency of non-overmodulated ordinary AM is $50\%$, but the maximum for a sinusoidal test tone at $100\%$ modulation is $33.3\%$.

This distinction matters because many examples use sinusoidal messages, but the theoretical maximum is stated for a different message shape.

## 8. Solving efficiency questions backwards

Sometimes the question gives the modulation efficiency and asks for the AM signal. For a sinusoidal message,

$$
\eta_{\text{mod}}=\frac{D^2/2}{1+D^2/2}\cdot100\%.
$$

Let

$$
e=\frac{\eta_{\text{mod}}}{100}
$$

be the efficiency as a decimal. Then

$$
e=\frac{D^2/2}{1+D^2/2}.
$$

Let

$$
x=\frac{D^2}{2}.
$$

Then

$$
e=\frac{x}{1+x}.
$$

Solving,

$$
e(1+x)=x,
$$

$$
e+ex=x,
$$

$$
e=x(1-e),
$$

so

$$
x=\frac{e}{1-e}.
$$

Since

$$
x=\frac{D^2}{2},
$$

we get

$$
\frac{D^2}{2}=\frac{e}{1-e}.
$$

Therefore

$$
D^2=\frac{2e}{1-e},
$$

and

$$
\boxed{D=\sqrt{\frac{2e}{1-e}}.}
$$

For example, suppose the required modulation efficiency is $20\%$. Then

$$
e=0.20.
$$

So

$$
D=\sqrt{\frac{2(0.20)}{1-0.20}}=\sqrt{\frac{0.40}{0.80}}=\sqrt{0.5}=\frac{\sqrt{2}}{2}.
$$

Thus the modulation percentage is

$$
D\cdot100\%=70.7\%.
$$

If the maximum signal amplitude is also given as $100\text{ V}$, then

$$
A_{\max}=A_c(1+D).
$$

So

$$
100=A_c\left(1+\frac{\sqrt{2}}{2}\right).
$$

Therefore

$$
A_c=\frac{100}{1+\frac{\sqrt{2}}{2}}\approx58.58.
$$

If the message tone has frequency $1000\text{ Hz}$, then

$$
\boxed{s(t)=58.58\left[1+\frac{\sqrt{2}}{2}\cos(2\pi\cdot1000t)\right]\cos(\omega_c t).}
$$

The $1000\text{ Hz}$ term is the message frequency. The carrier frequency is unknown, so it remains written as $\omega_c$.

## 9. Average power in AM

Efficiency becomes clearer when we explicitly write the power terms.

A sinusoidal voltage

$$
A\cos(\omega t)
$$

across a resistance $R$ has average power

$$
P=\frac{A^2}{2R}.
$$

The unmodulated carrier is

$$
A_c\cos(\omega_c t).
$$

Therefore the carrier power is

$$
\boxed{P_c=\frac{A_c^2}{2R}.}
$$

For ordinary AM,

$$
s(t)=A_c[1+m(t)]\cos(\omega_c t).
$$

The total average power is

$$
\boxed{P_{\text{total}}=P_c\left(1+\langle m^2(t)\rangle\right).}
$$

The carrier power is

$$
P_c.
$$

The sideband power is

$$
\boxed{P_{\text{sidebands}}=P_c\langle m^2(t)\rangle.}
$$

For a sinusoidal message,

$$
m(t)=D\cos(\omega_m t),
$$

we have

$$
\langle m^2(t)\rangle=\frac{D^2}{2}.
$$

Therefore

$$
\boxed{P_{\text{total}}=P_c\left(1+\frac{D^2}{2}\right)}
$$

and

$$
\boxed{P_{\text{sidebands}}=P_c\frac{D^2}{2}.}
$$

A single-tone AM signal has two equal sidebands, so each sideband has power

$$
\boxed{P_{\text{each sideband}}=P_c\frac{D^2}{4}.}
$$

The modulation efficiency is then

$$
\eta_{\text{mod}}=\frac{P_{\text{sidebands}}}{P_{\text{total}}}\cdot100\%.
$$

Substituting,

$$
\eta_{\text{mod}}=\frac{P_c\langle m^2(t)\rangle}{P_c(1+\langle m^2(t)\rangle)}\cdot100\%.
$$

The $P_c$ cancels, giving

$$
\eta_{\text{mod}}=\frac{\langle m^2(t)\rangle}{1+\langle m^2(t)\rangle}\cdot100\%.
$$

So the power formulas and the efficiency formula are consistent.

## 10. AM spectrum for a single-tone message

Now we derive the spectrum of an AM signal. Start with

$$
s(t)=A_c[1+D\cos(2\pi f_m t)]\cos(2\pi f_c t).
$$

Expand:

$$
s(t)=A_c\cos(2\pi f_c t)+A_cD\cos(2\pi f_m t)\cos(2\pi f_c t).
$$

Use

$$
\cos(a)\cos(b)=\frac{1}{2}\cos(a+b)+\frac{1}{2}\cos(a-b).
$$

Then

$$
A_cD\cos(2\pi f_m t)\cos(2\pi f_c t)=\frac{A_cD}{2}\cos(2\pi(f_c+f_m)t)+\frac{A_cD}{2}\cos(2\pi(f_c-f_m)t).
$$

Therefore

$$
\boxed{s(t)=A_c\cos(2\pi f_c t)+\frac{A_cD}{2}\cos(2\pi(f_c+f_m)t)+\frac{A_cD}{2}\cos(2\pi(f_c-f_m)t).}
$$

This expression shows exactly what is inside a single-tone AM signal:

$$
f_c
$$

is the carrier frequency,

$$
f_c+f_m
$$

is the upper sideband, and

$$
f_c-f_m
$$

is the lower sideband.

![pasted 1781960002075](/communication-1/assets/pasted-1781960002075.png)

The time-domain cosine amplitudes are:

$$
\text{carrier amplitude}=A_c,
$$

$$
\text{upper sideband cosine amplitude}=\frac{A_cD}{2},
$$

$$
\text{lower sideband cosine amplitude}=\frac{A_cD}{2}.
$$

This gives a useful recognition formula:

$$
\boxed{D=2\cdot\frac{\text{one sideband cosine amplitude}}{\text{carrier cosine amplitude}}.}
$$

For example, if

$$
s(t)=100\cos(2\pi f_c t)+30\cos(2\pi(f_c+f_m)t)+30\cos(2\pi(f_c-f_m)t),
$$

then

$$
A_c=100
$$

and

$$
\frac{A_cD}{2}=30.
$$

So

$$
D=\frac{2\cdot30}{100}=0.6.
$$

The modulation percentage is

$$
60\%.
$$

## 11. Two-sided Fourier spectrum of AM

In a Fourier transform, a cosine produces two impulses:

$$
A\cos(2\pi f_0t)\quad\longleftrightarrow\quad\frac{A}{2}\delta(f-f_0)+\frac{A}{2}\delta(f+f_0).
$$

Therefore, in a two-sided amplitude spectrum, every cosine component appears at both positive and negative frequencies.

For the carrier term

$$
A_c\cos(2\pi f_c t),
$$

the spectrum contains impulses at

$$
f=+f_c
$$

and

$$
f=-f_c,
$$

each with weight

$$
\frac{A_c}{2}.
$$

For the upper sideband term

$$
\frac{A_cD}{2}\cos(2\pi(f_c+f_m)t),
$$

the cosine amplitude is

$$
\frac{A_cD}{2}.
$$

So each Fourier impulse has weight

$$
\frac{1}{2}\cdot\frac{A_cD}{2}=\frac{A_cD}{4}.
$$

The same applies to the lower sideband.

Thus the two-sided Fourier spectrum has carrier impulses at

$$
f=\pm f_c
$$

with weight

$$
\frac{A_c}{2},
$$

and sideband impulses at

$$
f=\pm(f_c+f_m)
$$

and

$$
f=\pm(f_c-f_m)
$$

with weight

$$
\frac{A_cD}{4}.
$$

This is a common exam trap. The sideband cosine amplitude in the time-domain expression is

$$
\frac{A_cD}{2}.
$$

But the two-sided Fourier impulse weight is

$$
\frac{A_cD}{4}.
$$

Likewise, the carrier cosine amplitude is $A_c$, but each carrier impulse has weight $A_c/2$.

## 12. General AM spectrum and bandwidth

For a general message $m(t)$ with Fourier transform $M(f)$, ordinary AM is

$$
s(t)=A_c[1+m(t)]\cos(2\pi f_c t).
$$

The spectrum is

$$
\boxed{S(f)=\frac{A_c}{2}\delta(f-f_c)+\frac{A_c}{2}\delta(f+f_c)+\frac{A_c}{2}M(f-f_c)+\frac{A_c}{2}M(f+f_c).}
$$

The first two terms are the carrier impulses at $\pm f_c$. The last two terms are shifted copies of the message spectrum.

If the message spectrum $M(f)$ is limited to

$$
|f|\le B,
$$

then the positive-frequency AM spectrum occupies

$$
f_c-B\le f\le f_c+B.
$$

Therefore the required AM bandwidth is

$$
\boxed{B_{\text{AM}}=2B.}
$$

The part from $f_c$ to $f_c+B$ is the upper sideband. The part from $f_c-B$ to $f_c$ is the lower sideband. Ordinary AM transmits both sidebands, even though for a real-valued message they contain related information.

## 13. Recognizing AM, DSB-SC, and SSB from formulas or spectra

In exams, you may be given a formula or a spectrum and asked to recognize the modulation format.

Ordinary AM has a carrier plus two sidebands:

$$
s(t)=A_c\cos(2\pi f_c t)+\frac{A_cD}{2}\cos(2\pi(f_c+f_m)t)+\frac{A_cD}{2}\cos(2\pi(f_c-f_m)t).
$$

The key sign is the carrier component at $f_c$.

Double-sideband suppressed carrier, or DSB-SC, has two sidebands but no carrier. A typical single-tone DSB-SC signal looks like

$$
s(t)=K\cos(2\pi(f_c+f_m)t)+K\cos(2\pi(f_c-f_m)t).
$$

There is no separate term at $f_c$.

For example,

$$
s(t)=15\cos(2\pi\cdot10100t)+15\cos(2\pi\cdot9900t)
$$

has two equal-frequency components centered around

$$
f_c=\frac{10100+9900}{2}=10000\text{ Hz}.
$$

The message frequency is the spacing from the center:

$$
f_m=10100-10000=100\text{ Hz}.
$$

There is no component at $10000\text{ Hz}$. Therefore this is DSB-SC, not ordinary AM.

Single-sideband modulation, or SSB, has only one sideband. If only $f_c+f_m$ is present, it is upper-sideband SSB. If only $f_c-f_m$ is present, it is lower-sideband SSB.

So the recognition rule is:

ordinary AM has a carrier and two sidebands;

DSB-SC has two sidebands and no carrier;

SSB has one sideband.

## 14. AM modulator block diagram

The ordinary AM signal is

$$
s(t)=A_c[1+m(t)]\cos(\omega_c t).
$$

A block diagram should reflect this formula.

First, the message $m(t)$ is scaled if necessary. For a sinusoidal message, the scaling is the $D$-factor:

$$
m(t)=D\cos(\omega_m t).
$$

Then a DC value $1$ is added:

$$
1+m(t).
$$

Then the result is multiplied by $A_c$:

$$
g(t)=A_c[1+m(t)].
$$

Finally, $g(t)$ is multiplied by the carrier:

$$
\cos(\omega_c t).
$$

So the ordinary AM modulator is:

$$
m(t)\rightarrow\text{scale}\rightarrow\text{add DC }1\rightarrow\text{multiply by }A_c\rightarrow g(t)\rightarrow\times\cos(\omega_c t)\rightarrow s(t).
$$

The compact version is

$$
m(t)\rightarrow g(t)=A_c[1+m(t)]\rightarrow\times\cos(\omega_c t)\rightarrow s(t).
$$

The added $1$ is the key feature. It creates the carrier component.

For DSB-SC, there is no added $1$. The modulator is simply

$$
m(t)\rightarrow\times A_c\cos(\omega_c t)\rightarrow s(t).
$$

This difference explains why ordinary AM has a carrier but DSB-SC does not.

## 15. Special case: carrier oscillator fails and $f_c=0$

A common exam variation is that the transmitter oscillator fails. Instead of producing a carrier

$$
\cos(2\pi f_c t),
$$

it produces a DC signal. If

$$
f_c=0,
$$

then

$$
\cos(2\pi f_c t)=\cos(0)=1.
$$

So the AM signal becomes

$$
s(t)=A_c[1+D\cos(2\pi f_m t)].
$$

Expanding,

$$
\boxed{s(t)=A_c+A_cD\cos(2\pi f_m t).}
$$

This is no longer a bandpass AM signal. It is a DC component plus a baseband tone.

Its spectrum contains a DC impulse at

$$
f=0
$$

with weight

$$
A_c,
$$

and impulses at

$$
f=+f_m
$$

and

$$
f=-f_m,
$$

each with weight

$$
\frac{A_cD}{2}.
$$

The exam warning is: if $f_c=0$, do not draw sidebands around a high carrier. Draw a baseband spectrum and do not forget the delta function at $f=0$.

## 16. Special case: adding DC after modulation

Another exam variation is that the AM signal is created correctly, but then a DC voltage is added after modulation.

The ordinary AM signal is

$$
s_{\text{AM}}(t)=A_c[1+m(t)]\cos(2\pi f_c t).
$$

If a DC voltage $V_{\text{DC}}$ is added, the transmitted signal becomes

$$
s_{\text{new}}(t)=A_c[1+m(t)]\cos(2\pi f_c t)+V_{\text{DC}}.
$$

This can still be considered amplitude-modulated because the information is still carried by the amplitude variation of the carrier. The added DC voltage vertically shifts the waveform, but it does not remove the AM structure.

In the frequency domain, adding a DC voltage adds an impulse at $f=0$:

$$
\boxed{S_{\text{new}}(f)=S_{\text{AM}}(f)+V_{\text{DC}}\delta(f).}
$$

At the receiver, an envelope detector can still be used if the AM envelope itself is suitable for envelope detection. The detector output will include an additional DC offset, which can be removed by filtering or subtracting the mean.

So a DC offset after modulation does not destroy AM. It adds an extra spectral component at zero frequency.

## 17. Double-sideband suppressed carrier modulation

Ordinary AM is

$$
s(t)=A_c[1+m(t)]\cos(\omega_c t).
$$

The $1$ creates the carrier. Since the carrier does not itself contain the message, it reduces modulation efficiency.

If we remove the $1$, we get double-sideband suppressed carrier modulation:

$$
\boxed{s(t)=A_cm(t)\cos(\omega_c t).}
$$

This is called **DSB-SC**:

double-sideband, because the multiplication produces an upper and lower sideband;

suppressed carrier, because there is no standalone carrier at $f_c$.

![pasted 1781960053425](/communication-1/assets/pasted-1781960053425.png)

For a sinusoidal message,

$$
m(t)=D\cos(\omega_m t),
$$

we get

$$
s(t)=A_cD\cos(\omega_m t)\cos(\omega_c t).
$$

Using the product-to-sum identity,

$$
s(t)=\frac{A_cD}{2}\cos((\omega_c+\omega_m)t)+\frac{A_cD}{2}\cos((\omega_c-\omega_m)t).
$$

There is no term

$$
A_c\cos(\omega_c t).
$$

So the carrier is absent.

For a general message,

$$
s(t)=A_cm(t)\cos(2\pi f_c t),
$$

and the spectrum is

$$
\boxed{S(f)=\frac{A_c}{2}M(f-f_c)+\frac{A_c}{2}M(f+f_c).}
$$

![pasted 1781960074932](/communication-1/assets/pasted-1781960074932.png)

Compare this with ordinary AM:

$$
S(f)=\frac{A_c}{2}\delta(f-f_c)+\frac{A_c}{2}\delta(f+f_c)+\frac{A_c}{2}M(f-f_c)+\frac{A_c}{2}M(f+f_c).
$$

The difference is the missing delta functions. DSB-SC has no carrier impulses.

Because there is no carrier, the ordinary percentage of modulation is not defined. In the course, this is often described as infinite percentage modulation because there is no carrier amplitude to compare against.

The modulation efficiency of DSB-SC is

$$
\boxed{100\%.}
$$

All transmitted power is in the sidebands. No power is wasted in the carrier.

However, DSB-SC cannot be recovered with a simple envelope detector. Since the signal changes sign, an envelope detector would not recover $m(t)$; it would lose the sign information. DSB-SC requires coherent detection, such as a product detector.

## 18. Envelope detector

An envelope detector is a simple circuit used to demodulate ordinary AM. It usually consists of a diode and an RC network. The diode rectifies the signal, and the RC part smooths out the fast carrier oscillations while following the slower envelope.

![pasted 1781960100198](/communication-1/assets/pasted-1781960100198.png)

For ordinary AM,

$$
s(t)=A_c[1+m(t)]\cos(\omega_c t).
$$

If

$$
1+m(t)>0
$$

for all time, then the envelope has the same shape as

$$
A_c[1+m(t)].
$$

After detecting the envelope, the receiver can remove the DC part and recover a scaled version of $m(t)$.

For sinusoidal AM,

$$
1+D\cos(\omega_m t)>0
$$

as long as

$$
D<1.
$$

At $D=1$, the envelope just touches zero. For $D>1$, the envelope crosses zero and envelope detection becomes distorted.

![pasted 1781960130131](/communication-1/assets/pasted-1781960130131.png)

The advantage of envelope detection is simplicity. It does not require the receiver to generate a synchronized local carrier. The disadvantage is that it only works correctly for ordinary AM when the envelope does not cross zero.

There is another important limitation. If multiple AM channels are passed directly into an envelope detector, the detector does not select one channel. It removes the carrier-like oscillations from all of them and collapses their amplitude variations toward baseband. The channels overlap and become mixed. This is why receivers first select or down-convert the desired channel before detection.

## 19. Product detector

![pasted 1781960233189](/communication-1/assets/pasted-1781960233189.png)

A product detector recovers the message by multiplying the received signal by a locally generated carrier and then low-pass filtering.

For ordinary AM,

$$
s(t)=A_c[1+m(t)]\cos(\omega_c t).
$$

Multiply by

$$
2\cos(\omega_c t).
$$

Then

$$
2s(t)\cos(\omega_c t)=2A_c[1+m(t)]\cos^2(\omega_c t).
$$

Using

$$
2\cos^2(\omega_c t)=1+\cos(2\omega_c t),
$$

we get

$$
2s(t)\cos(\omega_c t)=A_c[1+m(t)]+A_c[1+m(t)]\cos(2\omega_c t).
$$

This contains a baseband term

$$
A_c[1+m(t)]
$$

and a high-frequency term around $2f_c$. A low-pass filter removes the high-frequency term, leaving

$$
A_c[1+m(t)].
$$

Then the DC part $A_c$ can be removed, leaving a scaled version of $m(t)$.

For DSB-SC,

$$
s(t)=A_cm(t)\cos(\omega_c t).
$$

Multiplying by $2\cos(\omega_c t)$ gives

$$
2s(t)\cos(\omega_c t)=2A_cm(t)\cos^2(\omega_c t).
$$

Using the same identity,

$$
2s(t)\cos(\omega_c t)=A_cm(t)+A_cm(t)\cos(2\omega_c t).
$$

After low-pass filtering, the output is

$$
\boxed{A_cm(t).}
$$

So a product detector can recover DSB-SC, while an envelope detector cannot.

The advantage of product detection is that it can recover ordinary AM, DSB-SC, and overmodulated AM. It can also select a desired channel by choosing the appropriate local oscillator frequency. The disadvantage is that the receiver must generate a carrier with the correct frequency and phase.

## 20. Phase error in product detection and IQ detection

Product detection works perfectly only if the local oscillator is synchronized with the transmitter carrier. Suppose the DSB-SC signal is

$$
s(t)=A_cm(t)\cos(\omega_c t).
$$

If the receiver multiplies by

$$
2\cos(\omega_c t+\phi),
$$

where $\phi$ is a phase error, then

$$
2s(t)\cos(\omega_c t+\phi)=2A_cm(t)\cos(\omega_c t)\cos(\omega_c t+\phi).
$$

Using

$$
2\cos(a)\cos(b)=\cos(a-b)+\cos(a+b),
$$

we get

$$
2\cos(\omega_c t)\cos(\omega_c t+\phi)=\cos(-\phi)+\cos(2\omega_c t+\phi).
$$

Since

$$
\cos(-\phi)=\cos(\phi),
$$

the product becomes

$$
A_cm(t)\cos(\phi)+A_cm(t)\cos(2\omega_c t+\phi).
$$

After low-pass filtering, the high-frequency part is removed, leaving

$$
\boxed{A_cm(t)\cos(\phi).}
$$

So a phase error scales the recovered message by

$$
\cos(\phi).
$$

If

$$
\phi=0,
$$

then

$$
\cos(\phi)=1,
$$

and recovery is maximal.

If

$$
\phi=90^\circ,
$$

then

$$
\cos(\phi)=0,
$$

and this branch recovers no message.

This is why IQ detection is useful. An IQ detector uses two branches: one multiplied by a cosine and one multiplied by a sine. The in-phase and quadrature components together preserve information about the signal’s amplitude and phase. For this course, the key idea is that coherent detection depends on the local oscillator, and phase mismatch affects the recovered signal.

## 21. AM in practical SDR transmission

In the lab, AM is transmitted using software-defined radio. The signal is generated digitally and then sent through radio hardware. This means the ideal AM formula is not the whole story. Practical gain settings matter.

If the gain is too low, the transmitted or received signal uses only a small part of the available amplitude range. Since the SDR stores the signal with a finite number of levels, this wastes resolution and can make the received signal poor.

If the gain is too high, the waveform can clip. Clipping cuts off the peaks of the signal, distorts the time-domain waveform, and changes the spectrum.

This is especially important for AM because the information is stored in the amplitude. Any unwanted amplitude distortion can directly corrupt the message. FM behaves differently because its information is stored mainly in frequency or phase variations, not in amplitude. This is why AM and FM can give different received spectra and different sound quality even under similar SDR settings.

The practical lab lesson is that AM is not only about writing

$$
s(t)=A_c[1+m(t)]\cos(\omega_c t).
$$

It is also about ensuring that the transmitter and receiver gains preserve the amplitude variations without clipping or wasting dynamic range.

## 22. Worked example: from waveform to AM parameters

Suppose an AM waveform has

$$
A_{\max}=50\text{ V}
$$

and

$$
A_{\min}=10\text{ V}.
$$

First find the carrier amplitude:

$$
A_c=\frac{A_{\max}+A_{\min}}{2}=\frac{50+10}{2}=30\text{ V}.
$$

Then find the modulation depth:

$$
D=\frac{A_{\max}-A_{\min}}{A_{\max}+A_{\min}}=\frac{50-10}{50+10}=\frac{40}{60}=\frac{2}{3}.
$$

So the modulation percentage is

$$
\frac{2}{3}\cdot100\%=66.7\%.
$$

If the message frequency is $200\text{ Hz}$ and the carrier frequency is $1000\text{ Hz}$, the AM signal is

$$
\boxed{s(t)=30\left[1+\frac{2}{3}\cos(2\pi\cdot200t)\right]\cos(2\pi\cdot1000t).}
$$

The modulation efficiency is

$$
\eta_{\text{mod}}=\frac{D^2/2}{1+D^2/2}\cdot100\%.
$$

Since

$$
D=\frac{2}{3},
$$

we have

$$
D^2=\frac{4}{9}.
$$

Therefore

$$
\frac{D^2}{2}=\frac{4/9}{2}=\frac{2}{9}.
$$

So

$$
\eta_{\text{mod}}=\frac{2/9}{1+2/9}\cdot100\%=\frac{2/9}{11/9}\cdot100\%=\frac{2}{11}\cdot100\%\approx18.18\%.
$$

This example shows why modulation percentage and efficiency must not be confused. A $66.7\%$ modulation depth gives only $18.18\%$ efficiency for a sinusoidal message.

## 23. Worked example: from spectrum to AM signal

Suppose the spectrum or formula shows the following time-domain components:

$$
100\cos(2\pi f_c t),
$$

$$
100\cos(2\pi(f_c+f_m)t),
$$

and

$$
100\cos(2\pi(f_c-f_m)t).
$$

The carrier cosine amplitude is

$$
A_c=100.
$$

For ordinary single-tone AM, each sideband cosine amplitude is

$$
\frac{A_cD}{2}.
$$

Here each sideband cosine amplitude is

$$
100.
$$

So

$$
100=\frac{100D}{2}.
$$

Therefore

$$
D=2.
$$

The modulation percentage is

$$
200\%.
$$

The AM signal can be written as

$$
\boxed{s(t)=100[1+2\cos(\omega_m t)]\cos(\omega_c t).}
$$

The modulation efficiency is

$$
\eta_{\text{mod}}=\frac{D^2/2}{1+D^2/2}\cdot100\%.
$$

Since

$$
D=2,
$$

$$
\frac{D^2}{2}=\frac{4}{2}=2.
$$

Therefore

$$
\eta_{\text{mod}}=\frac{2}{1+2}\cdot100\%=66.7\%.
$$

This is overmodulated ordinary AM. It has higher modulation efficiency than $100\%$ sinusoidal AM, but a simple envelope detector cannot recover it correctly. A product detector is needed.

## 24. Worked example: recognizing DSB-SC from two sidebands

Suppose the signal is

$$
s(t)=20\cos(2\pi\cdot200t)+20\cos(2\pi\cdot300t).
$$

The two frequencies are $200\text{ Hz}$ and $300\text{ Hz}$. Their center is

$$
f_c=\frac{200+300}{2}=250\text{ Hz}.
$$

The spacing from the center is

$$
f_m=300-250=50\text{ Hz}.
$$

So the signal can be viewed as two sidebands around a suppressed carrier at $250\text{ Hz}$. There is no separate carrier term at $250\text{ Hz}$. Therefore the modulation format is DSB-SC.

The modulation percentage is undefined, or described as infinite in this course context, because there is no carrier component. The modulation efficiency is

$$
100\%.
$$

If a carrier is added at the receiver to make it look like standard AM with $100\%$ modulation, the added carrier must have frequency $250\text{ Hz}$. Its amplitude must be chosen so that the sideband-to-carrier ratio corresponds to $D=1$. Since each sideband amplitude is $20$, and for standard AM each sideband amplitude is $A_cD/2$, for $D=1$,

$$
20=\frac{A_c}{2}.
$$

So

$$
A_c=40.
$$

The added oscillator should therefore be

$$
40\cos(2\pi\cdot250t).
$$

## 25. Final solving strategy

When solving an AM question, first identify the modulation type. If the signal has a carrier and two sidebands, it is ordinary AM. If it has two sidebands but no carrier, it is DSB-SC. If it has only one sideband, it is SSB.

For ordinary single-tone AM, write the signal as

$$
s(t)=A_c[1+D\cos(2\pi f_m t)]\cos(2\pi f_c t).
$$

Then determine $D$. If a waveform is given, use

$$
D=\frac{A_{\max}-A_{\min}}{A_{\max}+A_{\min}}.
$$

If modulation percentage is given, use

$$
D=\frac{\%\text{ modulation}}{100}.
$$

If efficiency is given, use

$$
D=\sqrt{\frac{2e}{1-e}},
$$

where $e$ is the efficiency as a decimal.

Then determine $A_c$. If $A_{\max}$ is given, use

$$
A_{\max}=A_c(1+D).
$$

If both $A_{\max}$ and $A_{\min}$ are given, use

$$
A_c=\frac{A_{\max}+A_{\min}}{2}.
$$

For the spectrum, remember that ordinary AM has a carrier at $f_c$ and sidebands at

$$
f_c-f_m
$$

and

$$
f_c+f_m.
$$

In a two-sided Fourier spectrum, every cosine gives two impulses. The carrier impulses have weight

$$
\frac{A_c}{2},
$$

and the sideband impulses have weight

$$
\frac{A_cD}{4}.
$$

For sinusoidal AM efficiency, use

$$
\eta_{\text{mod}}=\frac{D^2/2}{1+D^2/2}\cdot100\%.
$$

For average power, use

$$
P_c=\frac{A_c^2}{2R},
$$

$$
P_{\text{total}}=P_c\left(1+\frac{D^2}{2}\right),
$$

and

$$
P_{\text{sidebands}}=P_c\frac{D^2}{2}.
$$

For DSB-SC, remember

$$
s(t)=A_cm(t)\cos(\omega_c t).
$$

There is no carrier, the modulation percentage is undefined or infinite, the efficiency is $100\%$, and product detection is required.

For detector questions, remember the central distinction. An envelope detector is simple and works for ordinary AM when the envelope does not cross zero. A product detector is more complex but can recover DSB-SC, overmodulated AM, and selected channels when the correct local oscillator is used.
