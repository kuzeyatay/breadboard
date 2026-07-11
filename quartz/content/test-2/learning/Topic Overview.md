---
title: "Topic Overview"
date: "2026-07-11T10:03:43.363Z"
knowledge_type: "topic-overview"
breadboardType: "topic_overview"
gardenId: "test-2"
generatedBy: "learn_button"
generated_by: "learn_button"
learningVersion: "learning_mrg752yg_r6zxzic"
learningVersionId: "learning_mrg752yg_r6zxzic"
sourceSetHash: "da4e4aa8c56753a3b736ce67191e566a20546815fb4beba56b78a636c1861ef5"
---

# Spiking Neural Networks

Spiking Neural Networks, or SNNs, are neural networks that communicate with discrete spike events instead of continuously passing dense activation values through every layer. A conventional artificial neural network usually treats information as numbers that are recomputed layer by layer. An SNN treats information as events in time: a neuron stays mostly quiet, accumulates input, and emits a spike only when its internal state crosses a firing threshold.

That one change reshapes the whole topic. Spikes make timing part of the representation. Sparse activity makes computation potentially cheaper because inactive neurons do not need to do as much work. Threshold-based firing makes latency, spike count, and energy just as important as accuracy. Learning in SNNs also becomes harder, because a spike is a discrete event, and discrete threshold events do not fit ordinary gradient-based training as smoothly as continuous activations do.

The central question of this garden is:

**How can a neural network use sparse timed spikes to make accurate decisions while reducing latency, energy, or adaptation cost?**

You will learn SNNs as a chain of ideas rather than as a list of definitions. First, you will see why event-driven computation is useful. Then you will build the mechanism of a spiking neuron, connect neurons into networks, compare the main training strategies, derive the evaluation metrics, and finally read performance results as tradeoffs rather than single-number rankings.

## Learning Spine

Start with the simplest intuition: a spike is a meaningful event. If nothing happens, the network may not need to compute much. If enough input arrives, a neuron fires. This gives SNNs their appeal for low-power and time-sensitive systems, especially when signals unfold over time.

The first mechanism to understand is the **Leaky Integrate-and-Fire neuron**. A spiking neuron has a membrane potential, which you can think of as an internal running signal. Incoming spikes push this potential upward. Leak pulls it downward over time. A firing threshold decides when the neuron emits a spike. Once you understand accumulation, leak, threshold crossing, and spike generation, the rest of the garden becomes much easier.

The next step is network organization. SNNs are not just isolated firing neurons; they are networks of spike pathways. Input layers encode incoming information, excitatory layers help propagate activity, and inhibitory layers help regulate it. The architecture matters because spike timing and spike count depend on how events move through the network.

Then comes learning. SNNs can be trained or adapted in several ways:

- **Surrogate gradient training** keeps gradient-based learning usable by approximating how learning signals pass through discrete spikes.
- **ANN-to-SNN conversion** starts from a trained artificial neural network and converts its behavior into a spiking form, often trading direct SNN training for reuse of an existing model.
- **Spike-Timing Dependent Plasticity**, or STDP, changes synaptic strength based on the relative timing of pre-synaptic and post-synaptic spikes.

Finally, SNNs must be evaluated with more than accuracy. A model that is accurate but slow may fail in real-time settings. A model that saves energy but loses too much accuracy may not be useful. A model with few spikes may be efficient, but spike count only matters when connected to energy, latency, and task performance. The garden therefore treats accuracy, latency, spike count, energy, normalized energy efficiency, and convergence time as one connected evaluation system.

## Recommended Reading Order

Read the garden in this order if you are new to SNNs:

1. [[learning/1. Why SNNs Need Events/_index|1. Why SNNs Need Events]]
   - [[learning/1. Why SNNs Need Events/1.1 Why Spiking Neural Networks Exist|Why Spiking Neural Networks Exist]]
   - [[learning/1. Why SNNs Need Events/1.2 Biological Inspiration Without Biological Overclaiming|Biological Inspiration Without Biological Overclaiming]]
   - [[learning/1. Why SNNs Need Events/1.3 The Leaky Integrate-and-Fire Neuron|The Leaky Integrate-and-Fire Neuron]]
   - [[learning/1. Why SNNs Need Events/1.4 Spiking Network Architecture|Spiking Network Architecture]]

2. [[learning/2. How SNNs Learn/_index|2. How SNNs Learn]]
   - [[learning/2. How SNNs Learn/2.1 How SNNs Learn|How SNNs Learn]]
   - [[learning/2. How SNNs Learn/2.2 Surrogate Gradient Training|Surrogate Gradient Training]]
   - [[learning/2. How SNNs Learn/2.3 ANN-to-SNN Conversion|ANN-to-SNN Conversion]]
   - [[learning/2. How SNNs Learn/2.4 Spike-Timing Dependent Plasticity|Spike-Timing Dependent Plasticity]]

3. [[learning/3. The Metrics That Make SNNs Measurable/_index|3. The Metrics That Make SNNs Measurable]]
   - [[learning/3. The Metrics That Make SNNs Measurable/3.1 Accuracy|Accuracy]]
   - [[learning/3. The Metrics That Make SNNs Measurable/3.2 Latency|Latency]]
   - [[learning/3. The Metrics That Make SNNs Measurable/3.3 Spike Count|Spike Count]]
   - [[learning/3. The Metrics That Make SNNs Measurable/3.4 Energy and Normalized Energy Efficiency|Energy and Normalized Energy Efficiency]]
   - [[learning/3. The Metrics That Make SNNs Measurable/3.5 Convergence Time|Convergence Time]]

4. [[learning/4. What the Results Show/_index|4. What the Results Show]]
   - [[learning/4. What the Results Show/4.1 Continuous Activations Versus Sparse Spikes|Continuous Activations Versus Sparse Spikes]]
   - [[learning/4. What the Results Show/4.2 Reading Accuracy and Energy Results Together|Reading Accuracy and Energy Results Together]]
   - [[learning/4. What the Results Show/4.3 Reading Latency Results|Reading Latency Results]]

5. [[learning/5. Energy and Learning Curve Results/_index|5. Energy and Learning Curve Results]]
   - [[learning/5. Energy and Learning Curve Results/5.1 Reading Energy and Spike Count Results|Reading Energy and Spike Count Results]]
   - [[learning/5. Energy and Learning Curve Results/5.2 Reading Training Loss Curves|Reading Training Loss Curves]]
   - [[learning/5. Energy and Learning Curve Results/5.3 Reading Training Accuracy Curves|Reading Training Accuracy Curves]]

6. [[learning/6. Where SNNs Fit and What Still Blocks Adoption/_index|6. Where SNNs Fit and What Still Blocks Adoption]]
   - [[learning/6. Where SNNs Fit and What Still Blocks Adoption/6.1 Neuromorphic Hardware Context|Neuromorphic Hardware Context]]
   - [[learning/6. Where SNNs Fit and What Still Blocks Adoption/6.2 Choosing an SNN Training Strategy|Choosing an SNN Training Strategy]]
   - [[learning/6. Where SNNs Fit and What Still Blocks Adoption/6.3 Applications for Low-Power Temporal Intelligence|Applications for Low-Power Temporal Intelligence]]
   - [[learning/6. Where SNNs Fit and What Still Blocks Adoption/6.4 Limits of the Results and Responsible Interpretation|Limits of the Results and Responsible Interpretation]]

This order matters because each later section depends on earlier intuitions. Metrics are easier after spike mechanics. Training tradeoffs are easier after event-driven computation. Result interpretation is easier after the formulas are clear. Method selection is easiest once accuracy, latency, energy, spike count, and convergence have already been separated.

## How To Learn This Topic

Use three passes.

On the first pass, focus on intuition. Ask: **What changes when neural activity becomes sparse and event-driven?** Do not try to memorize every metric immediately. Make sure you can explain why a spike is different from a continuous activation value.

On the second pass, focus on mechanisms. Draw a simple LIF neuron and label input, membrane potential, leak, threshold, and spike output. Then draw a small network and trace how spikes move from an input layer through excitatory and inhibitory activity. If you can explain when a neuron fires and how spikes travel, the architecture and training sections will feel grounded.

On the third pass, focus on tradeoffs. For every method, ask what it seems to optimize:

- Surrogate-gradient SNNs are important when high accuracy and low latency are priorities.
- Converted SNNs are useful when reuse of a trained ANN is attractive, while accepting costs such as longer simulation windows or more spikes.
- STDP-based SNNs are important when low-power adaptive learning is the priority, while accepting slower convergence or lower accuracy in some comparisons.

The main habit to build is multi-metric thinking. Never ask only "Which model is best?" Ask "Best for what constraint?" Accuracy-sensitive, latency-sensitive, energy-sensitive, and adaptation-sensitive deployments can point to different choices.

## What This Garden Covers

This garden covers the foundations needed to reason about SNNs as event-driven neural systems. It explains why sparse spikes matter, how a simple spiking neuron fires, how SNN layers organize spike flow, how the major training approaches differ, and how to evaluate SNNs with accuracy, latency, spike count, energy, normalized energy efficiency, and convergence time.

It also covers practical interpretation. You will learn how to read comparisons among ANN baselines, converted SNNs, surrogate-gradient SNNs, and STDP-based SNNs without reducing the result to a single winner. The goal is to choose an SNN approach based on the deployment priority: accuracy, latency, energy efficiency, spike sparsity, or adaptive learning.

Application coverage stays focused on settings that fit the SNN argument: edge AI, robotics, neuromorphic vision, brain-computer interfaces, sensory processing, mobile low-power inference, and neuromorphic computing contexts such as IBM TrueNorth and Intel Loihi as examples of low-power event-driven hardware directions.

## What This Garden Does Not Cover

This garden does not try to be a complete survey of all SNN research. It does not cover every neuron model, every learning rule, every neuromorphic chip, or every benchmark used in the broader field. It also does not teach implementation in PyTorch, snnTorch, Brian2, Nengo, Norse, or other software frameworks.

The mathematical treatment stays focused on the formulas needed for evaluation: accuracy, latency, total spikes, total energy, normalized energy efficiency, and convergence time. It does not develop a deeper formal theory of spiking dynamics beyond the concepts needed to understand the LIF model, spike trains, training methods, and performance tradeoffs.

Hardware discussion stays conceptual. Neuromorphic chips appear as examples of why sparse event-driven computation is attractive, not as a detailed chip specification or commercial readiness comparison.

The safest way to read this garden is as a structured path into SNN reasoning: understand events, understand firing, understand training, measure the right costs, and choose methods by tradeoff rather than by a single headline metric.