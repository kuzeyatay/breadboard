---
title: "Frequency and Phase Modulation"
date: "2026-06-20T16:04:52.074Z"
source: "user-note"
knowledge_type: "user-note"
---

# Frequency and Phase Modulation: Modulation Index, Frequency Deviation, Carson’s Rule, and the FM Spectrum Table

After amplitude modulation, the natural next question is whether the information must always be carried by the amplitude of a carrier wave. In AM, the carrier oscillates quickly at the carrier frequency, while the message changes the height of the waveform envelope. That works, but it also means that unwanted amplitude changes in the channel can look like changes in the message. If the received amplitude fluctuates because of attenuation, antenna orientation, fading, gain settings, or another physical effect, an AM receiver may partly interpret that fluctuation as information.

Frequency modulation and phase modulation solve this problem by putting the message into the **angle** of the carrier instead of into its amplitude. The transmitted signal still uses a high-frequency carrier so that it can occupy a chosen passband, but the carrier amplitude remains constant. The information is now carried by changes in phase or by changes in instantaneous frequency. This is why FM and PM are called **angle modulation** methods.

![pasted 1781972574258](/communication-1/assets/pasted-1781972574258.png)

The general angle-modulated transmitted signal is

$$
s(t)=A_c\cos\!\big(\omega_c t+\theta(t)\big).
$$

Here, $s(t)$ is the transmitted bandpass signal, $A_c$ is the constant carrier amplitude, $\omega_c=2\pi f_c$ is the carrier angular frequency in rad/s, $f_c$ is the carrier frequency in Hz, and $\theta(t)$ is the time-dependent phase term that carries the message. The important structural point is that $A_c$ does not vary with the message. The message changes the argument of the cosine, not the amplitude in front of the cosine.

The same expression can also be written using the complex envelope

$$
g(t)=A_c e^{j\theta(t)}
$$

and

$$
s(t)=\Re\{g(t)e^{j\omega_c t}\}.
$$

Here, $g(t)$ is the complex envelope and $\Re\{\cdot\}$ means “take the real part.” This form is useful because it separates the high-frequency carrier $e^{j\omega_c t}$ from the lower-frequency information-dependent term $e^{j\theta(t)}$. For FM and PM, the magnitude of $g(t)$ is constant and equal to $A_c$; only its angle changes.

The difference between PM and FM is how the message $m(t)$ enters $\theta(t)$. In **phase modulation**, the phase is directly proportional to the message:

$$
\theta(t)=D_p m(t).
$$

Here, $m(t)$ is the baseband message signal and $D_p$ is the phase sensitivity constant. If $m(t)$ is larger, the phase shift is larger. If $m(t)$ is zero, the extra phase shift is zero. PM therefore directly maps message amplitude into phase deviation.

In **frequency modulation**, the message controls the instantaneous frequency deviation. Because instantaneous frequency is related to the derivative of phase, the phase must be proportional to the integral of the message:

$$
\theta(t)=D_f\int_{-\infty}^{t}m(\tau)\,d\tau.
$$

Here, $D_f$ is the frequency deviation constant, $\tau$ is a dummy integration variable, and $m(\tau)$ is the message evaluated inside the integral. This formula says that in FM the message does not directly become the phase; instead, the accumulated message determines the phase. Taking the derivative of this phase gives the frequency deviation.

The instantaneous frequency of the transmitted signal is

$$
f_i(t)=f_c+\frac{1}{2\pi}\frac{d\theta(t)}{dt}.
$$

Here, $f_i(t)$ is the instantaneous frequency in Hz. The carrier frequency $f_c$ is the center frequency around which the FM signal moves. The second term,

$$
f_d(t)=\frac{1}{2\pi}\frac{d\theta(t)}{dt},
$$

is called the **instantaneous frequency deviation**. It tells us how far the instantaneous frequency is from the carrier frequency at time $t$. For FM, substituting the FM phase expression gives

$$
f_d(t)=\frac{D_f}{2\pi}m(t).
$$

This is the key FM relation. The message $m(t)$ controls the deviation of the carrier frequency away from $f_c$. If $m(t)>0$, the instantaneous frequency is above $f_c$. If $m(t)<0$, the instantaneous frequency is below $f_c$. If $m(t)=0$, the instantaneous frequency equals $f_c$.

The **peak frequency deviation** is the maximum frequency shift caused by the modulation:

$$
\Delta F=\max\left|\frac{1}{2\pi}\frac{d\theta(t)}{dt}\right|.
$$

Here, $\Delta F$ is measured in Hz and is always treated as a nonnegative number. For FM,

$$
\Delta F=\frac{D_f}{2\pi}\max|m(t)|.
$$

This is one of the most important distinctions in this section. $\Delta F$ is not the same thing as the message frequency $f_m$. The message frequency $f_m$ tells how quickly the message oscillates in time. The peak frequency deviation $\Delta F$ tells how far the carrier frequency is pushed away from $f_c$. If the message is

$$
m(t)=A_m\cos(2\pi f_m t),
$$

then $A_m$ controls $\Delta F$, while $f_m$ controls the spacing between the spectral lines. Increasing the message amplitude increases the frequency deviation. Increasing the message frequency does not automatically increase $\Delta F$; it changes how quickly the deviation moves back and forth.

For a sinusoidal FM message,

$$
m(t)=A_m\cos(2\pi f_m t),
$$

the FM phase becomes

$$
\theta(t)=D_f\int A_m\cos(2\pi f_m t)\,dt.
$$

Solving the integral gives

$$
\theta(t)=\frac{D_f A_m}{2\pi f_m}\sin(2\pi f_m t),
$$

where any constant phase term can be ignored if it is not relevant to the problem. Therefore the transmitted FM signal becomes

$$
s(t)=A_c\cos\!\left(2\pi f_c t+\frac{D_f A_m}{2\pi f_m}\sin(2\pi f_m t)\right).
$$

Here, $A_c$ is the carrier amplitude, $f_c$ is the carrier frequency, $D_f$ is the frequency deviation constant, $A_m$ is the amplitude of the sinusoidal message, and $f_m$ is the message frequency. This formula is often the cleanest way to write an FM signal from a given single-tone message.

The coefficient in front of the sine term is the **frequency modulation index**:

$$
\beta_f=\frac{\Delta F}{B}.
$$

Here, $\beta_f$ is dimensionless, $\Delta F$ is the peak frequency deviation in Hz, and $B$ is the one-sided bandwidth of the modulating signal $m(t)$. For a single sinusoidal tone, the message bandwidth is simply

$$
B=f_m.
$$

So for single-tone FM,

$$
\beta_f=\frac{\Delta F}{f_m}
$$

and since

$$
\Delta F=\frac{D_f A_m}{2\pi},
$$

we also get

$$
\beta_f=\frac{D_f A_m}{2\pi f_m}.
$$

This expression is useful because it shows the two competing effects. Larger message amplitude $A_m$ gives larger deviation and therefore larger $\beta_f$. Larger message frequency $f_m$, with the same peak deviation, gives smaller $\beta_f$, because the deviation is compared to a wider message frequency scale.

For PM, the **phase modulation index** is simpler:

$$
\beta_p=\Delta \theta,
$$

where $\Delta\theta$ is the peak phase deviation in radians. If

$$
\theta(t)=D_p m(t),
$$

then

$$
\Delta\theta=D_p\max|m(t)|.
$$

Here, $D_p$ is the phase sensitivity constant and $\max|m(t)|$ is the peak magnitude of the message. Unlike $\beta_f$, the PM modulation index is directly the peak phase swing. It is measured in radians, but radians are dimensionless, so $\beta_p$ is also treated as dimensionless.

FM and PM are closely related because both change the angle of the carrier. The frequency is the derivative of phase, so any time-varying phase also implies a frequency variation. However, they are not the same mapping for an arbitrary message. PM makes $\theta(t)$ proportional to $m(t)$. FM makes $d\theta(t)/dt$ proportional to $m(t)$. For a single sinusoidal tone, both lead to the same standard spectrum form after the correct modulation index $\beta$ is known, but the phase relationship to the original message differs.

![pasted 1781972595569](/communication-1/assets/pasted-1781972595569.png)

For exam-style problems, the safest sequence is: first identify $m(t)$, then calculate $\Delta F$, then calculate $\beta_f$, and only then write the FM signal or draw the spectrum. For example, suppose

$$
m(t)=\frac{1}{\sqrt{2}}\cos(2\pi\cdot1000t)
$$

and

$$
D_f=2\pi\cdot10^3.
$$

Then

$$
\theta(t)=D_f\int m(t)\,dt
=(2\pi\cdot10^3)\int \frac{1}{\sqrt{2}}\cos(2\pi\cdot1000t)\,dt.
$$

Since

$$
\int \cos(2\pi\cdot1000t)\,dt=\frac{1}{2\pi\cdot1000}\sin(2\pi\cdot1000t),
$$

we obtain

$$
\theta(t)=\frac{1}{\sqrt{2}}\sin(2\pi\cdot1000t).
$$

If the carrier frequency is $f_c=100\,\text{kHz}$ and the carrier amplitude is $A_c=58.58$, the FM signal is

$$
s(t)=58.58\cos\!\left(2\pi\cdot10^5t+\frac{1}{\sqrt{2}}\sin(2\pi\cdot1000t)\right).
$$

The important step is solving the integral. Simply writing $D_fm(t)$ inside the cosine would be PM-like, not FM.

![pasted 1781972611015](/communication-1/assets/pasted-1781972611015.png)

The spectrum of FM and PM is more complicated than the spectrum of AM. For ordinary AM with one sinusoidal message, the spectrum has a carrier and two sidebands. For FM or PM with one sinusoidal message, the spectrum generally has infinitely many sidebands. These sidebands are spaced by the message frequency $f_m$, and their amplitudes are determined by Bessel functions.

For the standard single-tone angle-modulated signal

$$
s(t)=A_c\cos\!\big(2\pi f_ct+\beta\sin(2\pi f_mt)\big),
$$

the spectrum contains components at

$$
f=f_c+n f_m,
$$

where $n$ is an integer:

$$
n=0,\pm1,\pm2,\pm3,\ldots
$$

The component with $n=0$ is located at the carrier frequency $f_c$. The components with $n=\pm1$ are the first pair of sidebands at $f_c\pm f_m$. The components with $n=\pm2$ are the second pair of sidebands at $f_c\pm2f_m$, and so on.

The amplitude of the $n$-th component is determined by the Bessel function

$$
J_n(\beta).
$$

Here, $J_n(\beta)$ is the Bessel function of the first kind of order $n$, and $\beta$ is the relevant modulation index: $\beta_f$ for FM or $\beta_p$ for PM. The course does not require deriving Bessel functions from scratch. Their role here is practical: once $\beta$ is known, the table gives the relative amplitudes of the spectral components.

A useful way to remember the table is this:

$$
\text{line location: } f_c+n f_m,
$$

$$
\text{line height: proportional to } J_n(\beta).
$$

In a two-sided Fourier-transform magnitude spectrum, each positive-frequency delta line has magnitude

$$
\frac{A_c}{2}|J_n(\beta)|.
$$

In a one-sided amplitude spectrum, the corresponding line is commonly drawn with amplitude

$$
A_c|J_n(\beta)|.
$$

This factor-of-two difference is only a plotting convention. The physical sideband pattern is the same. In exam drawings, the important requirements are that the components are placed at the correct frequencies, the relative amplitudes come from the correct $\beta$ column of the Bessel table, and the spectrum is symmetric in magnitude around the carrier.

![pasted 1781972628715](/communication-1/assets/pasted-1781972628715.png)

For example, suppose $\beta=2$. A typical Bessel table gives approximately

$$
J_0(2)=0.2239,\quad
J_1(2)=0.5767,\quad
J_2(2)=0.3528,\quad
J_3(2)=0.1289,\quad
J_4(2)=0.0340.
$$

The spectrum around the positive carrier therefore has components at

$$
f_c,\quad f_c\pm f_m,\quad f_c\pm2f_m,\quad f_c\pm3f_m,\quad f_c\pm4f_m,\ldots
$$

with relative magnitudes approximately

$$
0.2239,\quad 0.5767,\quad 0.3528,\quad 0.1289,\quad 0.0340,\ldots
$$

multiplied by $A_c$ for a one-sided amplitude spectrum, or by $A_c/2$ for a two-sided delta spectrum. Notice something non-AM-like: the carrier component is not necessarily the largest component. In fact, for some modulation indices $J_0(\beta)$ can become zero, meaning that the discrete spectral line at $f_c$ disappears even though the signal is still centered around the carrier frequency.

The sign of $J_n(\beta)$ can be negative. For a magnitude spectrum, the sign is ignored because the plotted height is $|J_n(\beta)|$. For an exact time-domain reconstruction, the sign corresponds to phase, but for most course spectrum sketches the magnitude is what matters.

The larger $\beta$ becomes, the more sidebands become significant. This is why FM normally occupies more bandwidth than AM. In AM, increasing the modulation depth changes the power distribution but does not change the sideband spacing or the number of sidebands for a single tone. In FM, increasing the message amplitude increases $\Delta F$, which increases $\beta_f$, which spreads the power across more sidebands. The total average power stays constant because $A_c$ stays constant, but the power is redistributed over a wider frequency range.

Since the exact FM/PM spectrum contains infinitely many components, we need a practical bandwidth estimate. This is the purpose of **Carson’s rule**. Carson’s rule states that approximately 98% of the power of an angle-modulated signal is contained in the bandwidth

$$
B_T=2(\beta+1)B.
$$

Here, $B_T$ is the total transmission bandwidth around the carrier, $\beta$ is the modulation index, and $B$ is the one-sided bandwidth of the message signal. For FM, since

$$
\beta_f=\frac{\Delta F}{B},
$$

Carson’s rule can also be written as

$$
B_T=2(\Delta F+B).
$$

This second form is often the easiest form to use in calculations. It directly says that the total FM bandwidth is approximately twice the sum of the peak frequency deviation and the message bandwidth.

For a single tone,

$$
B=f_m,
$$

so

$$
B_T=2(\Delta F+f_m)=2(\beta_f+1)f_m.
$$

This is a total bandwidth. It describes the width of the occupied band around the positive carrier, from approximately

$$
f_c-\frac{B_T}{2}
$$

to

$$
f_c+\frac{B_T}{2}.
$$

The single-sided offset from the carrier is therefore

$$
\frac{B_T}{2}=(\beta+1)B.
$$

For $\beta=2$ and a single-tone message, Carson’s rule gives

$$
B_T=2(2+1)f_m=6f_m.
$$

That means the useful band extends approximately from

$$
f_c-3f_m
$$

to

$$
f_c+3f_m.
$$

The spacing between lines is still $f_m$. Carson’s rule does not tell the spacing; it tells how far outward the significant sidebands extend.

A common course-style example is an FM equivalent system with a peak frequency deviation

$$
\Delta F=5\,\text{kHz}
$$

and message tones at $90\,\text{Hz}$ and $180\,\text{Hz}$. The message bandwidth is the highest relevant tone frequency,

$$
B=180\,\text{Hz}.
$$

The modulation index is

$$
\beta_f=\frac{\Delta F}{B}
=\frac{5000}{180}
\approx27.8.
$$

Carson’s rule gives

$$
B_T=2(\Delta F+B)
=2(5000+180)
=10360\,\text{Hz}.
$$

So the FM signal needs about

$$
B_T\approx10.36\,\text{kHz}
$$

of total bandwidth. This is much larger than the bandwidth that would be needed to transmit the same low-frequency tones using ordinary AM, where the occupied bandwidth would mainly be determined by twice the highest message frequency. This example captures the usual AM/FM trade-off: FM is more robust against amplitude fluctuations, but it usually requires substantially more bandwidth.

![pasted 1781972658869](/communication-1/assets/pasted-1781972658869.png)

The FM/PM spectrum table should be used in a fixed order. First, determine whether the question already gives $\beta$. If it does, go directly to that column of the Bessel table. If it does not, calculate $\Delta F$, then calculate $\beta_f=\Delta F/B$. Second, identify the message tone frequency $f_m$, because this determines the spacing between the spectral components. Third, draw the carrier at $f_c$. Fourth, add sidebands at $f_c\pm nf_m$. Fifth, take the heights from the Bessel table using $J_n(\beta)$. Finally, use Carson’s rule to decide how many sidebands are significant enough to include in the effective bandwidth.

The most common mistake is mixing up $\Delta F$ and $f_m$. They are both frequencies, but they play different roles. The message frequency $f_m$ is the spacing between spectral lines. The peak frequency deviation $\Delta F$ is how far the instantaneous carrier frequency moves away from $f_c$. The modulation index $\beta_f$ compares these two quantities. A large $\Delta F$ with a small $f_m$ gives a large $\beta_f$, many important sidebands, and a wide FM spectrum.

Another common mistake is treating FM as if it had only the carrier and two sidebands. That is only an AM intuition. FM and PM with sinusoidal modulation create a theoretically infinite family of sidebands. In practice, many of them are small, so Carson’s rule and the Bessel table tell us which ones matter.

A third common mistake is forgetting that $B$ in Carson’s rule is the bandwidth of the message $m(t)$, not the carrier frequency and not the transmission bandwidth. For a single tone, $B=f_m$. For a message containing several tones, $B$ is the highest relevant message frequency. If the message contains $90\,\text{Hz}$ and $180\,\text{Hz}$, use $B=180\,\text{Hz}$, not $90\,\text{Hz}$, and not $90+180\,\text{Hz}$.

A fourth common mistake is writing FM without integrating the message. If the message is $m(t)=A_m\cos(2\pi f_mt)$, the FM phase contains a sine term because the integral of cosine is sine. Therefore

$$
s(t)=A_c\cos\!\left(2\pi f_ct+\frac{D_fA_m}{2\pi f_m}\sin(2\pi f_mt)\right).
$$

Writing

$$
A_c\cos(2\pi f_ct+D_fA_m\cos(2\pi f_mt))
$$

would describe direct phase modulation, not frequency modulation, unless the problem explicitly defines the phase that way.

In practical terms, FM is less sensitive to amplitude variations because the information is not encoded in the amplitude. If the signal is attenuated but its zero crossings and phase/frequency evolution remain readable, the message can still be recovered. This is why FM is often associated with better noise immunity than AM. The price is that FM usually occupies more bandwidth and requires a more complex receiver than a simple AM envelope detector. An envelope detector follows amplitude; it does not directly recover information hidden in phase or frequency.

This also explains why an SDR lab can show different spectra for AM and FM even when the same audio file and similar transmission settings are used. AM changes the envelope of the carrier, so its spectrum follows the shifted message content in a relatively direct way. FM changes the instantaneous frequency, so the spectrum spreads according to the deviation and the modulation index. Changing gain or transmission power can improve or degrade the measured spectral output, but the fundamental difference between AM and FM comes from where the information is placed: amplitude for AM, angle for FM.

The essential chain of ideas is therefore: FM and PM keep the carrier amplitude constant and encode information in the carrier angle. PM directly maps the message into phase; FM maps the message into instantaneous frequency, so the phase is the integral of the message. The peak frequency deviation $\Delta F$ measures how far the carrier frequency moves away from $f_c$. The modulation index $\beta_f=\Delta F/B$ compares that deviation with the message bandwidth. A larger $\beta$ spreads the spectrum over more Bessel-weighted sidebands. Carson’s rule then gives the practical total bandwidth $B_T=2(\beta+1)B=2(\Delta F+B)$. These ideas together are what allow you to write the FM/PM signal, interpret the spectrum table, and estimate the bandwidth needed for transmission.
