---
title: "Refraction, Fermat's Principle, Apparent Images, and Total Internal Reflection"
date: "2026-06-25T06:53:29.006Z"
source: "upload"
knowledge_type: "source-document"
source_type: "pdf"
source_file: "977689_English.pdf"
generated_by: "chatmock"
topics: ["least-time-principle-for-refraction", "snells-law-and-bending-direction", "apparent-position-of-a-fish-under-water", "atmospheric-refraction-and-flattened-sunsets", "critical-angle-for-total-internal-reflection", "total-internal-reflection", "optical-fibers-and-light-confinement", "prisms-reflectors-and-diamond-sparkle", "lecture-transition-from-refraction-to-wave-optics"]
tags: ["diamond-cut-maximizes-light-return", "huygens-principle-derives-refraction", "light-confinement-requires-angle-condition", "oblique-incidence-increases-distortion", "path-length-differs-from-travel-time", "refraction-follows-time-minimization", "sine-ratio-constrains-refraction", "sine-ratio-sets-critical-angle", "snell-law-derives-refraction", "snell-law-relates-interface-angles"]
source_images: ["/physics-for-ee/assets/977689-english-page-001.png", "/physics-for-ee/assets/977689-english-page-002.png", "/physics-for-ee/assets/977689-english-page-003.png", "/physics-for-ee/assets/977689-english-page-004.png", "/physics-for-ee/assets/977689-english-page-005.png", "/physics-for-ee/assets/977689-english-page-006.png", "/physics-for-ee/assets/977689-english-page-007.png", "/physics-for-ee/assets/977689-english-page-008.png", "/physics-for-ee/assets/977689-english-page-009.png", "/physics-for-ee/assets/977689-english-page-010.png", "/physics-for-ee/assets/977689-english-page-011.png", "/physics-for-ee/assets/977689-english-page-012.png", "/physics-for-ee/assets/977689-english-page-013.png", "/physics-for-ee/assets/977689-english-page-014.png"]
source_pdf: "/physics-for-ee/assets/977689-english-source.pdf"
---

## Summary

This lecture segment explains refraction through analogies, observations, and applications. It uses a lifeguard running and swimming problem to illustrate that light follows the path of least time when traveling through media with different speeds or refractive indices. It explains apparent image displacement in water, where a fish appears higher than it really is because rays bend away from the normal when leaving water for air. The material also describes atmospheric refraction at sunset, where rays from different parts of the Sun bend by different amounts, making the Sun appear flattened. The final topic is total internal reflection, which occurs when light travels from a higher refractive index medium to a lower refractive index medium at angles above the critical angle. The critical angle is derived from Snell's law using the condition $\theta_B = 90^\circ$, giving $\sin \theta_c = n_B/n_A$. Applications include optical fibers, laser light trapped in water streams, bicycle reflectors, prisms, and the sparkle of diamonds due to their high refractive index and small critical angle.

## Knowledge tree

- [[least-time-principle-for-refraction|Least-Time Principle for Refraction]] (Page 12)
- [[snells-law-and-bending-direction|Snell's Law and Bending Direction]] (Page 12, Page 13)
- [[apparent-position-of-a-fish-under-water|Apparent Position of a Fish Under Water]] (Page 12)
- [[atmospheric-refraction-and-flattened-sunsets|Atmospheric Refraction and Flattened Sunsets]] (Page 12, Page 13)
- [[critical-angle-for-total-internal-reflection|Critical Angle for Total Internal Reflection]] (Page 13)
- [[total-internal-reflection|Total Internal Reflection]] (Page 13)
- [[optical-fibers-and-light-confinement|Optical Fibers and Light Confinement]] (Page 13, Page 14)
- [[prisms-reflectors-and-diamond-sparkle|Prisms, Reflectors, and Diamond Sparkle]] (Page 13, Page 14)
- [[lecture-transition-from-refraction-to-wave-optics|Lecture Transition from Refraction to Wave Optics]] (Page 13, Page 14)

## Source material

# Page 1

You may be more excited than I am for today, as a midterm test. My excitement starts afterwards, when I'm grading your work. But a bit of excitement still, because I hope all logistics works out as I planned. We'll see.

So please sit in the room assigned to you. There's plenty of time. I will not run over time today, because actually it should be a tiny bit shorter than two times 45 minutes.

But today we're going to start on Module 6, on light: the nature and propagation of light.

Before I do that, however, let's briefly recap. Remember how waves work: waves on a string, standing waves on a string. This was, I think, an exam question two years back, final test or the resit, I can't remember. This is a type of question you should be able to do, and this indeed may involve a bit of calculation. But you should be able to do this.

Sometimes it helps to make a drawing. Have a string fixed at two ends. So it can have this mode, can have this mode, can have this mode, etc., right? And being a number of antinodes. And there's one, and it's two, and it's three, etc.

Are we ready to vote? Not yet. Let me try to guide you through answering this.

Of this expression, which of these parts denotes the spatial behavior, which denotes the time behavior? The second part denotes `sin(omega t)`, so that's a temporal, time behavior. So the spatial part is the only thing you need to answer this question, because this question is about the spatial behavior of this string. That already rules out all the answers with an omega in it, because that relates to the time behavior, right?

Okay, so then there's four left. Because all of these modes will vibrate in time, and they have a sine as all the time behavior. So that does not dictate how the string behaves in a spatial sense, right? So of the four answers we still have left, the ones without omega. So that's C, D, E, and G.

Who would vote for C? D? E? Few others. And what was lost on G? And there's still no consensus yet.

Okay. How do we solve this? `sin(kx)`: that's the spatial behavior. I need fixed points at `x = 0`. I need `sin(kx) = 0`; that's satisfied by default, right? But also at `x = L`, I need `sin(kL)` to be zero.

This happens if this argument is multiples of pi. So this happens if `kL = n pi`, where `n` goes from 1, 2, 3, etc. And in this way I can express `L` as `n pi / k`.

So which of these is `n pi / k`? Answer G would be the correct one.

Okay. So this is assumed prior knowledge, that you know when the sine is zero. It's calculus, right? But this is how to solve this question, okay.

Question? Yeah, so that's yeah, too, but if you can express it in that way in terms of wave number, for instance, that's also fine. This is the spatial behavior.

No, this is the only correct answer. There should not be an omega, because omega describes only this. Let me rephrase. Let me start again.

A standing wave is a superposition of a forward-traveling wave and a backward-traveling wave, at exactly the right frequency and exactly the right velocity. After combining that, you end up with a description that exactly looks like this for two fixed ends. You have the fundamental modes and the higher modes, etc.

So sine as a function of `t`: this could be a cosine if you want. But if you'd start from rest, it starts like this, and this dictates the spatial behavior.

So you may use the wave velocity as an intermediate step, but ultimately, if you write it back to the given parameters, you end up with answer G.

# Page 2

Okay. Let me continue.

So that's what we got last time: the wave equation, which was a scary-looking thing here of partial derivatives. And there are solutions to this: forward-traveling and backward-traveling waves. Look at overlapping waves and standing waves.

So these were the key takeaways of the last lecture.

Today we're going to look at light, and how that propagates, and how that behaves. A lot of this will be repetition: Snell's laws you've seen in secondary school. But there's also some nice discussion.

Already before Christ, people knew that light could reflect from smooth surfaces. The philosophers with the ancient Greeks thought that we saw things by sending out rays from our eyes, which then reflected on the object, and in that way we could detect everything around us.

Also, the ancient Greeks observed that light can be refracted, which is bending at an interface between two boundaries that have different material properties, different refractive indices. So this started already a long time ago.

Then, in the 17th century, there was a debate about the nature of light. We had Newton, the celebrated physicist who basically developed Module 2 for you. And we had Christiaan Huygens, a Dutch guy. They were in conflict: one thought light was a particle, the other one thought it was a wave.

The truth is, it's actually both. You can look at different interpretations to explain different phenomena. I'll get back to that in Module 7, on quantum mechanics.

People tried to measure the speed of light, and they did this using astronomy. By looking at an eclipse of moons, in this case Jupiter, so the moon Io of Jupiter, they made an estimate that light was `2.1 x 10^8 m/s`, which is a pretty decent estimate, I would say, for that time.

Almost 200 years later, they refined that to a better estimate. This was only five percent off.

Then Maxwell predicted electromagnetic waves that would be traveling at the speed of light. So that's a known constant: the speed of light in vacuum is almost `3 x 10^8 m/s`.

Then Heinrich Hertz, a German guy, demonstrated that this did not only hold for light, but also for any electromagnetic wave. So not just a visible spectrum, but any electromagnetic wave.

Now we had Einstein, who started the discussion on whether light was a particle or a wave, and he quantized light in terms of photons, light particles. He defined them, and he needed that to explain the photoelectric effect, which I'll also come back to in detail in quantum physics.

Then after quantum mechanics, they agreed that light is both a particle and a wave. Depending on what phenomenon you are explaining, you need either one interpretation or the other, but never both at the same time.

Absorption and emission of light are best described by particles, because this feels like a discrete thing: a light particle is absorbed and then re-emitted. Whereas propagation, and also interference, for that you really need the wave behavior of light. I'll come back to interference and diffraction, for instance, in the lecture on Monday next week.

Of course, XKCD has something to say about light interpretation, interpreting physics. There's two viewpoints, and probably the average is the truth. Well, that holds for this example, holds also for light. This could be thought of as coincidence, but it is the case.

To get more to the real content of today's lecture: there is a whole spectrum of electromagnetic waves. Of course, there's the very low frequencies, with wavelengths in the order of meters. You have AM radio, all the way up to cell phone communication, which is in the gigahertz range. There's the terahertz range, where there's visible light. Then you can go to ionizing radiation, radiation that really damages cells because it can get electrons loose from the atoms. Then you are talking about ionizing radiation, which is really harmful to the human body.

Another way to look at this is here. So there's a radio spectrum. There's a microwave spectrum, terahertz, and then we get to light: infrared, ultraviolet. In between, there's the visible light, of course. Then you go to the ionizing radiations: X-rays, soft and hard X-ray, which are really damaging to tissue, and then gamma radiation.

So this probably you know. Propagation of light holds for all of this, but we typically confine ourselves to this narrow

# Page 3

region because we talk about visible light.

Also, when we talk about rainbow formation, we look at the colors in visible light. Of course, this range goes from, what is that, 380 nanometers to 750, 770 nanometers. And that's what we call visible light.

There's infrared here, ultraviolet here, and the eye has three cones in the retina that are sensitive to different colors of light. These overlap. It's designed by nature in this way, so we have to work with this. So we can distinguish between blue, green, and red colors, and their combination gives all the visible spectrum.

So much for the introduction. Let's go to how to work with this.

To describe how light propagates, we need the concept of wavefronts and light rays.

A wavefront: consider a point source in space, which radiates light in all directions. Then the wavefront is like, if it sends out a wave, you can think of where the peak of this wave is, how that is propagating in space. You could consider that a wavefront, and that propagates outwards in radial directions.

What characterizes these points is that they all have the same phase. So it's always a peak of a wave that is propagating outwards. If I draw the locus, so the collection of all the points that have that same phase, I would get a spherical shell for a point source.

But this holds in general. I can draw a wavefront as being the locus of all adjacent points at which the phase of vibration is the same. We talk about light. This could also be waves on the string, waves on the pond. Then the wavefront is this: if you throw a rock in the pond, then you see the circles spread. Then the first circle spreading is a wavefront spreading in a circular way, right?

This could be a sound point source, but can be any source basically that generates waves. For any wave, you can define wavefronts, right?

Next to wavefronts, we have rays. A ray is, I'll say, a beam of light propagating in a certain direction. At every point on a wavefront, a light ray indicates in what direction this wavefront is moving.

If we look at homogeneous isotropic media, which is what we will confine ourselves to in this course, then we have the rays always perpendicular to the wavefronts. If a wave is propagating outwards, say the circular example: you throw a rock or a stone in the pond and it spreads cylindrically, then the rays in which it spreads are from this point outwards in radial direction, and the wavefronts are circles. By definition, that's kind of a top-down view of what we see here. The rays are always locally perpendicular to the wavefronts.

If you look at the description of light in terms of rays, then you talk about the field of geometrical optics, where you mainly look at geometry and how that influences light rays. That's basically all of the calculations you've done at your secondary school with light going through prisms, through blocks of glass, for instance. All of that is based on geometrical optics.

We will also confine ourselves to that, because those problems are difficult enough already. They use a lot of trigonometry, which is often a challenge.

If you have a source that's really far away, then the source has a spherical spreading of the light rays coming from that source. So the wavefronts are spheres. But if you're far away, then locally where you're looking at these rays, they arrive kind of just as plane waves, right? If you're far enough away, then consider this a zoomed-in-enough part of this sphere, where locally you just have parallel wavefronts. Then you have a plane wave, which is the approximation we often make.

Also, if you have a very focused light source like a laser, it emits a small, confined beam. Within that beam, there are wavefronts that are perpendicular to that beam.

Okay. This is called plane waves. That's the assumption we typically make when we look at spreading or propagation of rays. For interference and diffraction, it's different. We need spherical sources or

# Page 4

cylindrical sources. But in general, what we do in geometrical optics: we have wavefronts perpendicular to the rays, and these are all parallel. So we consider plane waves.

Okay, can we have two wavefronts from the same wave cross one another?

Who thinks yes? Who thinks no? The rest doesn't have an opinion yet.

Indeed, it is no. Because each wavefront represents a certain phase. If you throw one stone in the water, you cannot have two wavefronts with the same phase cross each other. There's a unique set of wavefronts coming out from that source. They can never cross, because at the point where they cross it would have two phases, which is a non-unique description. So you can't have wavefronts crossing themselves, right?

Double-slit experiment? No, then you have two wavefronts, two sources, and then you can do interference. Yeah, so after the double-slit experiment, which I'll cover next Monday and also on Thursday next week, there's two sources. Then you have two sources that generate wavefronts, and then you can make an interference pattern.

They don't have the same phase. No, no, it has propagated to the mirror and has been reflected, is coming back soon. Yeah, so every phase changes every `2 pi` multiples, right? So it propagates and propagates back, and then it has two wavelengths' difference, for instance, and then it doesn't have the same phase. The same absolute phase relative. Yes.

There was a question there. Yeah, yeah, I'll get back to that in detail as well in this lecture. Yeah, but also that is a way to construct wavefronts. You make the locus of all of these Huygens sources to generate the new wavefront, basically. But it's still the same source. It's still the assumption that there's one plane wave incident on the medium that you're looking at.

Let me get to the important part: reflection and refraction.

As a general example, I think this is a picture from the book, the previous version of the book. This woman outside losing her head due to wind, and then she sees her head reflected in the window. Also these guys on the inside drinking coffee see through the window this hat outside. So light goes through glass, but it's also partly reflected by glass.

We need to describe how that works and how to do calculations on that. So we need reflection and refraction, reflection and transmission, to describe what is happening here.

Have you ever thought of why a mirror seems to flip only left-right and not up-down? If you look in the mirror, you just see that right mirror, but never up-down. Why is it?

Anyone who has a clue? You can change the angle whatever you want. You will never see yourself flipped upside down.

No, upside down. So that, yeah, if you do like this, then still left-right is flipped, right? So how does it work?

No, that's not the reason.

If it's concave, yeah, then you get distortion of the image, but still left-right. Yeah, then you talk about lenses. I'm talking about flat mirrors.

No. She closed one eye; you still see left-right flipped.

Yeah, there's no wrong answers here. This is really a tricky question.

Kind of on track, yeah, but that feels like flipping left-right. What? No, the mirror will not do that for you.

Yeah, that is a difficult way of explaining the real answer, but you're on the right track, actually. You flip forward-backwards in the mirror, and due to how you perceive that, you see left and right flip. It's front and back that flips.

You can never see the back of your head in the mirror, unless you have a second mirror. But it flips front and back, and we perceive that as flipping left and right, because you look at the mirror front, and then it reflects back at you front-back. So that's an eye-opener, literally, for how mirrors work. There's more questions like this later.

Yeah, I hope this was clear. So it does not flip up-down or left-right. It flips front and back, and that makes us perceive it as flipping left-right. But if you hold an object facing forward, you will never see the back of that object. You will see the forward side of that object reflected in the mirror.

Okay, let's look at the schematic view. Typically, we have reflection and refraction. So we have two media that we need, typically called medium 1, medium B-sorry, medium A.

## Page 5

Medium B. There's an incident ray. Part of that gets refracted, so bent and transmitted, and part of it gets reflected. We can do this for many rays, but we assume that we have a plane wave with a wave front like this incident on the interface, and then it propagates also with plane wave fronts like that, and it's reflected also with plane wave fronts in that direction.

So just for convenience we often draw only one ray, and that's how the next pictures will look like. I just draw one ray that gets refracted and reflected.

So, and we also need angles to describe this. If there's an interface between two surfaces, there's always a normal to the interface. So a line perpendicular to the surface, even for curved surfaces locally at every point on a smoothly curved surface, there is a normal, a unique definition of a normal pointing outward from that surface perpendicular to the surface locally. And then angles are always measured with respect to this normal. So there's the incident angle, theta I, and the reflected angle, theta R, and if there's refraction, there's also theta. And this is what you know already from Snell's laws.

In general, I think the angle of incidence is the angle of reflection, always measured relative to the normal to the surface, right? Yeah, sometimes either the book or I give the angles not with respect to the normal, but you have to bear in mind that you have to calculate the angle with respect to the normal to do, well, angle of incidence equals angle of reflection, right?

That depends on friction and surface properties of the ball, but if you angle the ball at the wall, then it will... Yeah, we don't use light for that. You would need the law of conservation of momentum to do calculations on that. There was a 2D problem on that with billiard balls in the instructions, I think. So with such calculations you would find that probably for completely elastic collisions the angle of incidence is the angle of reflection, but in general, that's not the case. For light it always holds.

How this happens depends on the smoothness of the surface. If you have a very smooth surface, you get so-called specular reflection. Is it the case we will consider? Well, always basically, where the angle of incidence is the angle of reflection, so the surface is locally smooth enough to allow for this. But if you look microscopically, it can be very diffuse. If you go to high enough frequencies and to a small enough object that you shine light on, you will see individual atoms and molecules that affect the reflection.

We typically look at this case only, so we have smooth surfaces such that we have this that holds: the angle of incidence is the angle of reflection. Okay. Yeah, so we mainly work with specular reflection.

So please try to summarize this for yourselves, these concepts. I think they are known already. I'm not sure if you used exactly this terminology. It would be good to write this down for yourselves. And then we'll start doing calculation on this. I'm just out of curiosity, for whom was light already covered in secondary school? Okay, for most of you. That's good, we'll do a recap anyway.

Some examples of specular reflection versus diffuse reflection can be seen here. If there's a pond in the mountains, there's no wind, you really get a nice mirror image. And in this case, well, there's asphalt, there's rain. It's very diffuse. So you get a lot of rays reaching your eye from different paths, not just a single path. So here is just this part. It's reflected exactly here and then you see it.

So let's set up how to do calculations with this. For that we need a property of the material. It's called the index of refraction. So if you have two media, there's always an interface between them. So medium A, medium B, there is an interface between them. And then if there's an interface, and we assume locally we have a flat interface, then locally we can define a normal vector that's perpendicular to the interface.

Every material has optical properties, which is a so-called index of refraction denoted by `n`, sometimes also called refractive index, which is a property of a medium that specifies how fast light propagates

## Page 6

through that medium. And this is relative to the speed of light in vacuum. So there's nothing faster than the speed of light in vacuum. So that's `c`. And the index of refraction is `c` over the velocity of light in a certain medium.

So if the index of refraction is 2, then the light in the medium goes half as fast as the speed of light in vacuum. So it slows down by 50 percent. I'll come back in detail to why light slows down in a second.

So there's the index of refraction, and typically it ranges from one upwards depending on the material you're looking at. So speed of light in vacuum is approximately three times ten to the eight meters per second. And if the index of refraction is defined as follows, then we can think of what happens in a medium.

The speed of light changes, but the frequency does not change. So that is a property of light. If you shine blue light through glass, it stays blue light. So the frequency does not change because that gives the color of light. But the wavelength then has to change because the velocity equals the wavelength times frequency. So if `v` changes and frequency stays constant, then lambda also has to change. Right? Lambda inside the medium is also scaled by the refractive index. So the wavelength is smaller in the medium that has an `n` higher than one.

So if light enters glass from vacuum to glass, you decrease the velocity, you decrease the wavelength, the frequency does not change, just the wavelength and the velocity. Okay.

Also light travels in a straight line except when it is reflected, or it moves from one medium to another. And for this we will use Snell's laws in a second, or after the break probably. So it moves in a straight line, then there's glass, so it bends towards normal in this case. We will see why later. And then afterwards it travels parallel to the original line and again in a straight line. Notice that this is really a defined beam through the glass, and then afterwards is also a confined beam of light, one ray of light. Well, it's a beam, but let's consider it as a ray for practical purposes.

And the bending of light relates to the medium travelling with different speeds inside the medium, so the light travelling with different speeds inside the medium. And I'll get back to that in the discussion part in a few slides. So it bends. And then the opposite effect takes place when it leaves the glass again. It bends backwards, well, away from the normal again to have a propagation direction that is parallel to this one. Yeah, this is what you've seen in secondary school as well, right?

Okay, some examples of refractive indices. And this depends on color as well. So let's assume that we have light of a certain color, so yellow light with this wavelength, 589 nanometers. Then different media have different indices of refraction for this wavelength.

So water: 1.3. Glass typically around one and a half. Quartz, diamonds; well, diamond has a higher refractive index, so light slows down even more in diamond. This is something you would look up in tables. What we do on our exams is we give, if we have two media, then we specify this one here as `n_A`. If it's air, then it's one for air, and this one typically has `n_B`, and we have to work with that. Don't concern too much about the numerical value. You should know that one is larger than the other to know in which direction light bends, but that's about it.

So let's do a bit of discussion. Think about glass. Typically `n` is one and a half. Why is glass then transparent? Does someone have an idea for that? Any frequencies? Okay. Yeah, first. Indeed, glass is transparent because it does not absorb light of visible frequencies.

So the band gap energy, and that relates back to the semiconductor physics part, the band gap energy between the energy levels of electrons in the shells around the atom, the nucleus, is such that visible light cannot excite these atoms into a higher state. So visible light is not absorbed by glass because the band gap energy is too high.

And glass is not transparent for higher frequency light, so light we don't see anymore. But if you think about X-rays or gamma rays, then glass is no longer transparent. It's just for visible light it happens that glass is, by such a combination of materials,

## Page 7

so it's silicon oxide basically, that has a band gap energy such that it does not absorb visible light.

Yeah, go ahead. Yeah. Yeah, so it also has to do with the geometry of the lattice. So silicon oxide in glass is bound in such a way that the band gap energy of glass does not permit absorption of light.

Yes, sand is not transparent in general. No, it's brownish because it has a different molecular structure.

Yes. So this depends largely on molecular structure, and there are really physics studies being done on characterizing such materials for a range of frequencies. And especially what ASML has to be doing for making their tips operate at these really, really high frequencies. They have to work with materials that have the right properties at these frequencies. So they need good characterization of these materials. Otherwise, you absorb light that you use for the lithography. That's not what you want.

Okay, next question. So why does light travel slower through glass? There are many explanations for this also on the internet. AI, I'm not sure if it does it correctly already. Why does it travel slower? Because the glass is a denser medium. Yeah, but what does that mean? Denser than air. Yes. Can you specify more or not? Yeah, go. I'll proceed. Yeah, go ahead. Yeah, but why would it slow down then? Not completely, but someone else perhaps?

There are all kinds of explanations. Let me use this one. There's the so-called ping-pong hypothesis. So if light travels through air, it goes like this, but if it travels through a medium, then it can bounce off atoms in the medium, and that makes the path longer, so it travels slower. This is not correct. Because why would the light come out in this direction? It could also go off in this direction or in that direction. That's not what we see if we shine a beam of light through a medium, the picture I had earlier. This does not look like it scatters in all directions, right?

There's also the idea that light could be absorbed by an atom, and that takes a bit of time, and then it's reemitted again to the next one, takes a bit of time, and that could also make it slow down through the material. That's also not correct. Because why would the light then propagate in this direction? If it's absorbed, it can be re-radiated in all directions. So again, then this picture would not happen. You would find a blob of yellow light come out from here because it would scatter in all directions.

Yeah, action? Yeah, okay, then you get to Feynman integrals and things like that. Perhaps at the end of today's lecture you can relate to that concept. I don't use the word action, but it's here.

It's different. Light does interact with the medium, but not in a way that it gets reflected or bounces off. We really need the wave nature of light to understand this, right? It is an electromagnetic wave. So when it goes through glass, these electromagnetic waves will wiggle all of the electrons that are connected to the atoms in the material. So these atoms go around in circles around the nucleus. But they do get excited if an electric field gets past them. Light is an electromagnetic wave, so it carries magnetic and electric fields.

So light will wiggle all of these atoms, and all of these atoms together, all of these electrons together, will generate a counteracting electric field that has the net effect that it slows down light just a little bit inside a medium. So it interacts with the medium in a subtle way. It's not absorption and re-emission, definitely not. But it does interact with the electrons, and these oscillations for the lattice of the medium that you're looking at create a net effect that it is effectively slowed down.

So there are two nice videos on this by Sixty Symbols. I'm not sure if you know that YouTube channel. Three Blue One Brown you probably know, right?

## Page 8

This is a really, really nice video. It's half an hour long, so I'm not showing that here. He really shows with his animations, I wish I could do these, he shows why the wavelength is different, why the result of the oscillations of the electrons in the lattice create the net effect that light has a shorter wavelength, what you see here, and slows down in glass. So that comes because of the electromagnetic interactions.

And the reason why light bends at an interface, it will go off in a different direction, also has to be described with the wave behavior of light, with the electric field that depends on, well, that scales with the permittivity, so a material property of the medium. That's probably what you meant as well.

Yeah, and that bending, there are also wrong explanations for that. This marching soldiers analogy in which they march through air and through mud; in mud they are slower, that would cause them to rotate. That's also not complete in explaining this effect.

So the Sixty Symbols... let me see. Well, there are other videos in that. I think I'll link these on the Canvas page. There are two nice videos of Fermilab explaining that as well. For what we need to know, we need to know that light slows down in the medium, and that it bends if it goes into a medium with higher refractive index, and that's because of the scaling of the electric field, which relates to the boundary conditions over the interface for the electric field.

I think that's a nice moment for a break. Let's continue at half past two.

Yes, we will continue. I would like to continue, then we can go to the midterm test well in time.

So let's look at how to do calculations on light. Let's look at how we work with reflection and refraction. For this we need Snell's laws. So let's first use some definitions. We have two media, medium 1 and 2, or A and B, typically A and B. And there's an incident ray on here. There's a reflected ray, and there's a refracted ray. Each has their own angle. So there's theta A, the incident ray; theta R, reflected ray; and theta B, the refracted ray.

And we assume that we have light of a single color, so that we don't have to take into account that there are multiple colors, each having a different refractive index. This works as a single color, monochromatic light. We typically call it monochromatic: single color.

Then we have Snell's laws. Snell's laws, actually. The first one is that all of this happens in a plane. This is a 2D plane in which all of this happens, so we can't have this coming out at an angle, forward for instance. It has to happen in a single plane. Locally this plane has to be at least perpendicular to the surface, but everything happens in that plane. So a 2D picture suffices to do calculations on this, a 2D drawing.

We have the angle of incidence equals the angle of reflection. So that I mentioned earlier: angle of incidence equals angle of reflection. This angle is the same as this angle because we don't change medium. So the angle is the same, always measured with respect to the normal, and the normal is this line perpendicular to the interface.

And then for refraction we have the law with the sines:

`n_A sin(theta_A) = n_B sin(theta_B)`

So the refractive index in medium one times the sine of the angle of incidence equals the refractive index of medium B times the sine of the angle in medium B.

And I'll give some examples now how to work with that. So this was discovered by a Dutch scientist. I can't take credit for this, but I'm still a bit proud. Quite a long time back, but even earlier there was documentation of this, 600 years earlier, by a Persian scientist. But Snell formalized this into the three laws.

Well, these you probably know. Try to write them down by yourselves. This should take half a minute only, and then we proceed with the examples.

So let's see if you understand the concepts. Let's do a quick quiz question. So what can you say about the angle of refraction at an interface between two media? Three options here. You can think of which of the three laws of Snell you would need for this. Who thinks A, B, C? No one dares to raise a hand for C? We got so much response. Indeed, it depends on the refractive index between the two media.

So let's see the three typical cases that we have. In case one, it goes to a medium that has a higher refractive index. This can be air, and then you go from air to glass, which has one and a half as a refractive index. And if you go to a higher refractive index, you bend towards the

# Page 9

So angle theta B is smaller than theta A. This follows from Snell's law.

So we had:

n_A sin theta_A = n_B sin theta_B

So:

sin theta_B = n_A / n_B sin theta_A

So if n_B is higher, this fraction is less than one. So the sine of this angle becomes smaller than the sine of that angle, so the angle has to become smaller.

So higher refractive index: you bend towards the normal. If you go to a lower refractive index, you bend away from the normal. That's the inverse of this. Well, the same still holds because it has to hold Snell's law. But n_B is now smaller than n_A. So this fraction becomes more than one, so sin theta_B is larger than sin theta_A, meaning that theta_B has to be larger than theta_A.

The reflected angle does not change. This should also be theta_A. Similarly, in the previous case, that is theta_A. The reflected angle also here is the same.

In case three, then the easiest one: if you have normal incidence, then you don't bend. The angles are the same, so it's 90 degrees on the way in, 90 degrees on the way out, always with respect to the normal. And the angle here is also 90, and that also relates to the sine.

Yeah, go ahead. It should be the same on both sides. We will do symbolic calculations anyway, so it shouldn't matter too much. You do whatever you're used to. If you think in degrees more easily, then well, we can convert degrees to radians, so that's fine. Depending on how the angle is given, sometimes it's given in degrees, and then you can work with that in degrees. Doesn't matter too much. We will do symbolic calculations anyway, and especially for these problems you will need to do construction and use some trigonometry to solve the problem. You will see that on Monday in the studio classroom.

So this gives effects like this, right? If you have something that's partly submerged in the water, it seems bent. Why does that happen? Well, it happens as follows. If you look at this point on the ruler going out, it goes from a medium with a higher refractive index to a medium of lower refractive index. So locally with respect to normal, this angle is smaller than the angle here. So it bends away from the normal.

So it arrives, well, it seems it arrives at your eye. This ray coming from this point arrives there at your eye. But for your eye, it seems to have come from here, because your eye cannot process that, well, the law of sines here. So it seems that it has propagated from here. So it seems that from where it's submerged in the water, it has been bent upwards, because it is perceived as coming from a different point. The eye thinks in straight lines, so it seems that it is observed here, whereas in fact it is here.

And this is what birds who hunt for fish have to account for, right? If it's standing on the water side and wants to stab a fish with its beak, then it really has to take this into account; otherwise you miss it. Hunters hunting for fish have to do the same. Have a spear. With a shotgun it gets different.

Okay, let's see if you understand the concept. And then I'll show a nice video.

In this section, n_A is smaller than n_B. What do we think? Answer A, answer B, answer C, answer D, answer E. But we have all options, so none of the above is not true.

It is indeed answer B. So we go towards a medium with a higher refractive index, so we bend towards the normal. And the medium has a higher refractive index, so light has to slow down while going into that medium. So answer B is correct.

Let me show you the cup and penny experiment, which I think this one just has no real sound; it doesn't add a lot today in the videos.

Let me put it on loop. So you don't see the penny when it's lying here. Well, just the rim. And when you pour water into it, you get the effect exactly as I showed in the figure. You can look more down into the cup because of water, because the light bends away, or the light coming from the penny bends towards you. So you make use of refraction to be able to see this.

Right, my kids like that when I show them this experiment.

So let's go to another principle to explain basically Snell's laws, and that's called Huygens' principle. Huygens' principle.

So another way to look at this, to construct solutions to such problems, is to consider every point on a wavefront. So bear in mind: wavefronts are an equal-phase plane of a wave propagating, so say all the local maxima, the troughs of a wave propagating. Rays are perpendicular to that.

You can consider all the points on the wavefront as a wavelet that spreads out light in all directions, and the speed is equal to the propagation speed of the wave in that medium.

# Page 10

So in air, at the speed of light, V is C. But in general in the medium, that's less than C. So all of these points will generate such circular wavelets going outwards. And by taking down a snapshot at a new time instance, you can calculate, well determine, the locus of all of these points again to see where we are then. And effectively what has happened is that you have propagated in the direction of the ray. That's it. That's kind of a step in between to construct such wavefronts.

If you think about a wavefront striking a surface, then for reflection you have to take into account that it can change direction. So it is incident on the surface. And if you construct, well, for every wavefront such a wavelet that travels Vt over time t, then at this point, for instance, these have touched the surface again.

So a wavelet from this point will generate a curve going out from this point, right? So let's construct that. So if you look at this wavefront at this time, and set it as a source point that we use exactly on the interface, and to do calculations, then we propagate this one outward also in all directions. Well, not towards the object, because it reflects, but outwards, upward in this case. And this will then create a, well, at V times t it will travel this distance. This point has also traveled in that same time V times t.

So this point V times C gives this semicircular arc. This point in V times C gives this semicircular arc. And these have to be on the same line because they belong to the same new wavefront, so we can draw a line connecting this point and that point.

So there are many solutions, of course, and that's also one disadvantage of the Huygens principle. If you do this with enough sources, you can construct a nice new wave. And in this way you will find that the reflected ray will be at a different angle than the incident ray.

So let's do this construction in detail. Let's try to look at how this happens. So we are going to zoom in on this red triangle that was connected to the wavefront going out from here, and a wave coming in, well, from here going in basically.

Let's construct that. So we zoom in on that triangle now. And we see that, well, in a time t, it has traveled this distance OB. And this wavefront has traveled the same distance from A to Q, also Vt. So that's also the two circular arcs that we can draw: this one coming in from here, so there's a circular arc here, and this one coming out from here, so there's a circular arc here.

Well, and these angles, these triangles, have to be similar triangles. So triangle, let me do the correct order: AOP. So it's on top, luckily. AOP has to have a similar shape as OAQ. So these two triangles have to be of similar shape.

They have a right angle here because this is how the ray propagates, perpendicular to the wavefront. Same here: this is perpendicular to the new wavefront, so perpendicular to the wavefront.

So these triangles have to have the same form, which means that all of their angles have to be the same. Well, this acute angle in this triangle, in triangle OAQ, has to be the same as the angle here in AOP. And that gives us that the angle of incidence has to equal the angle of reflection.

So this is also confirming that the angle of incidence is the angle of reflection, but now using Huygens sources.

So bear in mind, the construction for this was that we looked at incident rays, reflected rays, and we used points on this wavefront as a Huygens source, creating a wavelet propagating outward with a velocity V. We're in the same medium, so the velocity is the same. And over the same time, we travel the same distance or the same radius. And that way we can find one of Snell's laws.

It's okay if you can follow the reasoning here. That's sufficient for this lecture. We will use Snell's laws. We do not need Huygens sources to do calculations. We will use Huygens sources a bit more when we talk about interference and diffraction, but that's something I'll cover on Monday.

Is this concept clear? Not completely, but yeah, please look in the book as well. That book may sometimes have a different explanation than I give here. So it has the advantage that you get two different explanations, one of which may resonate better with your mind.

# Page 11

We can also look at waves striking an interface. So we have two materials now. We have this situation: medium A, medium B. And in medium A there's a higher velocity, so typically air. Medium B is, let's call it glass; the velocity is lower. So within the same time, in medium A we travel more distance than in medium B.

And also here we can do a detailed construction by looking at basically this part here. We're zooming in on this part and looking at what happens there. So this distance is different from this distance because the speeds in the media are different, right? Still, we have triangles that look kind of similar because they share this hypotenuse. OA is the same for both triangles.

These are right angles. So we can define the sine of theta_B as being AB over OA. That's the sine of theta_B. The sine of theta_A is A'O over OA. So that's V_A t over OA. And then we can equate OA from this equation to find Snell's law.

Sorry, yeah, you can imagine that you get to this if you equate OA, where you take into account that the velocity of the medium scales with the refractive index.

So V_A, that's the ingredient you need:

V_A = C / n_A

V_B = C / n_B

And together with these two, you can create Snell's law because t drops out, C drops out, and OA you will eliminate from the equation. And then you get Snell's law. But now from a Huygens point of view, is that clear?

The important part is that you can work with Snell's laws. This is another way of looking at them, but Huygens sources we need later also for a double-slit experiment. And that's why I need them to at least be introduced here.

Okay, please try to summarize this as well. What is a Huygens source? How does it work? Why is it useful?

We'll go to some examples.

Well, a nice example of something you can explain with Huygens' principle is a mirage. So if you're in a really hot desert, you can see phantom reflections of things on the soil. And this works as follows.

Well, I say examples of Huygens' principle can be explained using Huygens' principle. Let's phrase it like that.

What you see is that a wavefront higher up, I'll say the head of the camel or the tip of a mountain, you see that directly. It travels straight on through air, and that's higher up. It can also travel because there's a gradient in the air. So that has cooler air higher up, hotter air near the ground, because the desert sand is really, really hot.

So there's a change of refractive index, a continuous change of refractive index over the height above the ground. And that makes that, well, depending on where the ray comes from, it may have traveled from a different point of view. Well, that's why you can see a reflection of the mountains here also, as coming from the sand. So this has the illusion of water lying there. So we can mistake that for a sheet of water that is lying there. That comes from a gradient in the refractive index over the air.

There's a nice video on that with a similar type of thing. So let's see, we've seen this one. Let's do this one first. There's light bending. So it's a laser. So it should send out a straight, sorry for this, should send out a straight beam. But you see that it bends, so it's not just straight; it curves. And that is caused by the fact that there is a gradient in the sugar in the water.

And similar here. So this is a straight line, but it's not always in a straight line. It can even seem to bounce. And this is caused, of course, by a similar effect as that we had with the mirage. There's a gradient in the sugar content. But if you turn it on top, it's a straight line. It's just a gradient in the vertical direction.

This is weird, right? It is caused by a gradient in the water, causing a gradient in refractive index. And that makes that you kind of create a waveguide based on the medium properties.

# Page 12

I'm really happy that the sound is off. This video has annoying music. You see that it bends already. So that's the same effect as the mirage we had earlier.

Careful, wake up.

So let's see if you understand the concepts. This is kind of also an analogy that is often used for why light bends. It does not explain how much it bends. It does explain some aspects of it.

Let's see if we understand this one. You can have sprinters on a parking lot. You can have a swimmer in the sea, and a lifeguard on the beach who has to run to the swimmer, and then swim also a certain distance. Swimming is slower than running. So you have the same effect: there's a medium on which you have a high velocity and a medium in which you have a low velocity.

So is it then worthwhile running the shortest distance, then running over sand? Or running the longest distance over the parking lot, and then just the shortest path through the sand? Who thinks path A is quickest? Path B? C? D? E?

Okay. Intuition of most of you is right. Or F, sorry. No, they don't all take the same time. That's obvious. Somewhere in between C and E there should be the optimal, well, the fastest path.

And this is exactly what light also does if there are media of different refractive indices. It takes the shortest time to get from P to Q. How does light know that? Well, it's a law of nature. It does this automatically; it happens like that. It can be explained using this shortest-time principle.

So that probably relates to the least-action explanation as well. But it does not explain the angles. You could do a calculation on this; actually might be a nice new example. Well, we'll see. But light does this as well: takes the shortest path.

Another one. Well, we're getting near the end. That's good.

Let's see if you recall what I mentioned earlier. Where do you see the fish? Who thinks answer A? Answer B? Also C? Indeed, the construction was like this: a ray of light coming from the fish goes from a high refractive index to a lower refractive index. So it bends away from the normal. So it seems as if it has come from, well, the eye thinks in straight lines, so from somewhere up here.

Okay. If you look at a sunset, that's safe to do because a lot of the harmful radiation is gone already.

Yeah, question. Yeah. Yeah, good point. Probably just vertically upward. It should be in the plane of you and the fish, and not only vertically upward. But if the water is choppy, so with waves, then it's really difficult to do this.

So probably, I would think, just straight up. But whether you see that, yeah, then it also seems smaller. So you misjudge in different ways how you see the fish. It might be smaller than you think. If you think it's bigger than as you see it, then you may mistake it for further away. Closer by, I mean. So yeah, there's a trade-off also between the interpretation of the viewer and where the fish is.

Let me get to the sunset. So this seems flattened from the bottom side. If you try to draw a circle, it seems flattened somehow, and that is also caused by refraction.

And the reason is that the Sun, well, say the Sun comes from far away. It has a size, a certain size. A ray from the top of the Sun comes at a different angle through the atmosphere, and a ray from the bottom of the Sun also.

Depending on where the ray enters the atmosphere, and this is why it's apparent at sunset, then you have the effect of the curvature of the atmosphere more. If it's straight up, well, the Sun is straight up, and all of the Sun beams come perpendicular down to you as an observer. But if it's at an angle, so at the sunset, then it seems as if lower parts of the Sun go through a different layer of atmosphere, also at a different angle.

And this causes a varying normal to the interface, so a varying index, a varying angle of refraction depending on the ray where it comes from. So rays from the top have seen, well, come from higher up, so they come from higher up than layers than rays from the bottom. They come from here, for instance, and they also arrive at your

## Page 13

eye. But at a different angle, so that's why you see that the Sun flattens at sunset, okay? Why this is red I'll come back here to next lecture.

So the final topic then is total internal reflection, so and then I'll manage before, yeah, way before quarter past.

So remember there is one case in which light bends away from the normal: that is if you go from a high refractive index to a lower refractive index. If you do this at a too large angle, so if one perpendicular incidence, it continues perpendicularly. If you increase the angle, then there is a certain angle where it bends so much, does it, that it doesn't leave medium A anymore. So it stays in medium A, does not go into medium B. So this is at the so-called critical angle.

So when theta B equals 90 degrees, so when the sine theta B is one, so then we have:

```text
n_a sin(theta_a) = n_B
```

From that we can calculate the critical angle, so theta A, the critical angle. This is the incident ray, is then:

```text
n_B / n_a
```

So this happens, well, this can only happen if `n_B` is lower than `n_a`, because the sine of something always has to lie between minus one and one. So this has to be, cannot be larger than one, then you don't find a solution. So we have to go from lower to higher refractive index, then you get a ratio that's less than one.

For every angle that is larger than this critical angle, then you get total reflection. So in that sense, that kind of answers your question as well. When do you have total reflection? That happens in this case. But in general, how much has been reflected, how much has been refracted? That's something that you really learn in the electromagnetics course, not in this course.

So how does that work? Well, let's use an animation that tries to build it up. If the ray is perpendicular, you get reflection and refraction, but it is at right angle, so you don't see that. If you increase the angle, you get something refracted, something reflected. If you increase the angle, you end up at an angle where it doesn't enter medium 2 anymore. So we have, at this case, one ray of light propagating along the interface, and then you still have the reflection. And if you go further, you only have the reflection; they have total internal reflection.

And sometimes we use this in problems as well because that's something you can do calculations with: for what angle do I have to shine light through a prism to get total internal reflection at the far end of the prism, for instance.

So some nice example here: there's light shining on three mirrors tilted at a different angle. Well, for one of the, well, at the critical angle, there's light also propagating along the interface, but it's, that's probably this one. But you still have the reflection. Also for these, you have reflections, so that's the reflection from this one. This gives a reflection there, and this gives total internal reflection. So this is the reflection. This is the ray of light that is not propagating into air. So just, it stays in the water.

I think this was also covered in the secondary school, at least for those who had optics there. Total internal reflection is used a lot if you think about optic fibers. That's, you want to confine light in the fibers. You want to transmit it as far as possible without it leaving the fiber, so you make use of total internal reflection.

There's also, if you have a beam of water pouring out of an aquarium, for instance, you can have the laser being totally internally reflected in the, sorry, let me play that again, in the beam of water. I think I have another one. So it doesn't leave the water. Due to total internal reflection, it stays inside the water. And that's how an optical fiber works as well.

There's another one. Again annoying sound, luckily I switched it off. Here you see a green laser that's confined in the water that's pouring out of a, well, a bottle in this case. You have to hold your hand perfectly still, otherwise you get out of the beam. That's right, okay.

This concept is used also in a lot of applications. If you have a reflector on the back of your bike, then, well, you make use of that concept that all the light coming in from whatever angle is reflected. So it lights up if you shine

## Page 14

light on it. That's exactly the purpose.

In prisms this can also be used. This is also what makes diamonds really shine. Diamonds are special in that sense because they have a high refractive index. So it's like glass typically has one and a half; diamonds, well, 2.4 typically. So there is a very small critical angle. It reflects lights really easily from whatever angle it comes in, and then how it's cut even emphasizes that more. So, well, it should maximize light return through the top. That's why they sparkle.

Okay, and actually I should have shown the movies here. This is what happens in fibers. You want to trap the light in the fiber. So it should always be a higher density, sorry, higher refractive index core compared to the cladding around the core. Because you have to, well, total internal reflection happens if you go from a high refractive index to a lower refractive index. That's how this works.

I think you want to go to a test, right? So to remember, we looked at the nature of light, reflection and refraction. Derived in two ways: Snell's law and Huygens' principle. And we looked at total internal reflection. And next Monday, we'll continue this with dispersion and also interference.

Good luck with the midterm test. I hope you all are here to make that, to do the test. Please go to the room assigned to you, and then, well, I'll see you on Monday. Good luck.

## Source snapshots

![977689_English Page 1](/physics-for-ee/assets/977689-english-page-001.png)

![977689_English Page 2](/physics-for-ee/assets/977689-english-page-002.png)

![977689_English Page 3](/physics-for-ee/assets/977689-english-page-003.png)

![977689_English Page 4](/physics-for-ee/assets/977689-english-page-004.png)

![977689_English Page 5](/physics-for-ee/assets/977689-english-page-005.png)

![977689_English Page 6](/physics-for-ee/assets/977689-english-page-006.png)

![977689_English Page 7](/physics-for-ee/assets/977689-english-page-007.png)

![977689_English Page 8](/physics-for-ee/assets/977689-english-page-008.png)

![977689_English Page 9](/physics-for-ee/assets/977689-english-page-009.png)

![977689_English Page 10](/physics-for-ee/assets/977689-english-page-010.png)

![977689_English Page 11](/physics-for-ee/assets/977689-english-page-011.png)

![977689_English Page 12](/physics-for-ee/assets/977689-english-page-012.png)

![977689_English Page 13](/physics-for-ee/assets/977689-english-page-013.png)

![977689_English Page 14](/physics-for-ee/assets/977689-english-page-014.png)
