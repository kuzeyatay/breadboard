---
title: "Topic Overview"
date: "2026-07-16T09:20:29.266Z"
knowledge_type: "topic-overview"
breadboardType: "topic_overview"
gardenId: "test-2"
generatedBy: "learn_button"
generated_by: "learn_button"
learningVersion: "learning_mrnask8c_laya7c2"
learningVersionId: "learning_mrnask8c_laya7c2"
sourceSetHash: "da4e4aa8c56753a3b736ce67191e566a20546815fb4beba56b78a636c1861ef5"
---

# Spiking Neural Networks

A spiking neural network, or **SNN**, computes with discrete events called **spikes**. Instead of passing a continuous activation from one layer to the next at every update, a spiking neuron accumulates incoming activity over time and emits a spike only when its internal state reaches a firing threshold. The occurrence of a spike matters, and its timing can matter too.

This shift from continuous values to timed events changes the central questions of neural computation:

- How can a sequence of spikes represent information?
- How does a neuron combine new input with activity retained from earlier time steps?
- How can networks of excitatory and inhibitory neurons select an output?
- How can a network be trained when spike generation is not differentiable?
- When does lower activity translate into lower energy use?
- Which training strategy best fits a particular deployment goal?

The aim of this garden is to connect those questions into one chain of reasoning. You will begin with individual spike events, follow them through a Leaky Integrate-and-Fire network, examine three ways to train SNNs, and then compare the resulting models using accuracy, latency, spike count, energy, and convergence behavior.

## The Learning Spine

The garden follows a mechanism-to-decision progression:

1. **Spikes create temporal computation.** Information can be carried not only by whether neurons fire, but also by when they fire and how spike events are distributed across an observation window.
2. **Neuron state connects events across time.** A Leaky Integrate-and-Fire neuron accumulates input in its membrane potential while gradually losing the influence of older input.
3. **Thresholds turn accumulated state into output.** When the membrane potential reaches a firing threshold, the neuron emits a spike and resets.
4. **Network organization turns spikes into decisions.** Encoded inputs drive excitatory and inhibitory populations, while lateral inhibition supports winner-take-all competition.
5. **Discrete spikes create a training problem.** The spike operation is non-differentiable, so ordinary gradient-based learning cannot be applied through it without modification.
6. **Different training strategies solve different parts of that problem.** Surrogate gradients approximate the missing gradient, ANN-to-SNN conversion transfers learned behavior into a spiking implementation, and Spike-Timing-Dependent Plasticity uses relative spike timing as a learning signal.
7. **No single metric determines the best model.** Accuracy must be considered alongside decision latency, spike activity, estimated energy use, and convergence.
8. **Deployment requirements determine the preferred tradeoff.** A low-latency system, a transferred ANN, and an unsupervised low-power system may each favor a different strategy.

Keep this spine in mind as you read. Each later idea should answer one of three questions: **How do spikes compute? How can spike-based networks learn? How should their tradeoffs guide deployment?**

## How to Learn This Topic

Begin with intuition rather than formulas. First picture a spike as an event occurring at a particular moment. Then picture membrane potential as a temporary memory: incoming activity raises it, leakage weakens older contributions, and threshold crossing converts the accumulated state into a new spike.

Once that mechanism is clear, follow information through the network as a sequence:

**encoded input -> spike trains -> membrane-potential changes -> emitted spikes -> excitation and inhibition -> winner selection**

Only then move to training. The three training strategies are easier to compare when you can state exactly why discrete spike emission causes difficulty for gradients.

Learn the evaluation metrics after the training methods, but before interpreting results. For every metric, ask:

- What quantity is being counted or timed?
- How is the metric calculated?
- What does a larger or smaller value mean?
- What important behavior does the metric leave out?

This is especially important for energy reasoning. Spike count is one contributor to estimated energy, but it is not the complete energy model because synaptic operations and their costs also contribute. Likewise, accuracy per joule is useful only when read alongside both accuracy and energy rather than as a replacement for them.

When you reach the comparisons, resist looking for a universal winner. Read each result as conditional on the evaluated models, datasets, simulation settings, energy assumptions, and operational priorities.

## Recommended Reading Order

### 1. Establish why spikes matter

Start with [[learning/1. Why Spiking Neural Networks Matters/_index|1. Why Spiking Neural Networks Matters]].

Read:

1. [[learning/1. Why Spiking Neural Networks Matters/1.1 Why Spiking Neural Networks Exist|Why Spiking Neural Networks Exist]]
2. [[learning/1. Why Spiking Neural Networks Matters/1.2 Why Training Spiking Networks Are Difficult|Why Training Spiking Networks Are Difficult]]

The first subsection introduces event-driven, brain-inspired computation without assuming that SNNs always outperform conventional neural networks. The second previews the central learning obstacle: threshold-based spike generation is discrete and therefore non-differentiable.

### 2. Build the computational mechanism

Continue to [[learning/2. How Spike Event Works/_index|2. How Spike Event Works]].

Read:

1. [[learning/2. How Spike Event Works/2.1 Spikes, Timing, and Temporal Information|Spikes, Timing, and Temporal Information]]
2. [[learning/2. How Spike Event Works/2.2 Event-Driven Computation and Energy Efficiency|Event-Driven Computation and Energy Efficiency]]
3. [[learning/2. How Spike Event Works/2.3 Membrane Potential, Input Integration, and Leakage|Membrane Potential, Input Integration, and Leakage]]
4. [[learning/2. How Spike Event Works/2.4 From Encoded Inputs to Competing Neurons|From Encoded Inputs to Competing Neurons]]
5. [[learning/2. How Spike Event Works/2.5 Excitation, Inhibition, and Winner Selection|Excitation, Inhibition, and Winner Selection]]

This sequence moves from a single spike to a network-level decision. Pay particular attention to the distinction between **sparse activity** and **guaranteed efficiency**: event-driven computation can avoid unnecessary operations, but measured energy still depends on the network, simulation, operation counts, and deployment system.

### 3. Formalize thresholds and measurements

Next read [[learning/3. Describing Firing Threshold Formally/_index|3. Describing Firing Threshold Formally]].

Recommended order:

1. [[learning/3. Describing Firing Threshold Formally/3.1 Threshold Crossing, Spike Emission, and Reset|Threshold Crossing, Spike Emission, and Reset]]
2. [[learning/3. Describing Firing Threshold Formally/3.2 Classification Accuracy|Classification Accuracy]]
3. [[learning/3. Describing Firing Threshold Formally/3.3 Inference Latency|Inference Latency]]
4. [[learning/3. Describing Firing Threshold Formally/3.4 Spike Count and Energy per Inference|Spike Count and Energy per Inference]]

The first subsection completes the Leaky Integrate-and-Fire cycle. The remaining subsections establish the quantities needed to evaluate a trained model. Work through each equation from its plain-language meaning, and define every count, timestamp, cost, and unit before interpreting the result.

### 4. Compare the three training strategies

Proceed to [[learning/4. How Surrogate Gradient Is Applied/_index|4. How Surrogate Gradient Is Applied]].

Read:

1. [[learning/4. How Surrogate Gradient Is Applied/4.1 Surrogate-Gradient Training|Surrogate-Gradient Training]]
2. [[learning/4. How Surrogate Gradient Is Applied/4.2 ANN-to-SNN Conversion|ANN-to-SNN Conversion]]
3. [[learning/4. How Surrogate Gradient Is Applied/4.3 Spike-Timing-Dependent Plasticity|Spike-Timing-Dependent Plasticity]]
4. [[learning/4. How Surrogate Gradient Is Applied/4.4 Evaluating SNNs Across Multiple Metrics|Evaluating SNNs Across Multiple Metrics]]

These methods address different goals:

- **Surrogate-gradient training** approximates gradients through spike generation so that an SNN can be trained directly.
- **ANN-to-SNN conversion** begins with a trained artificial neural network and transfers its behavior into a spiking implementation.
- **Spike-Timing-Dependent Plasticity**, or **STDP**, adapts connections using the relative timing of spikes and is associated here with unsupervised and low-power settings.

Do not reduce the comparison to "which method has the highest accuracy?" A useful comparison must also include latency, simulation duration, spike count, energy, and convergence behavior.

### 5. Interpret the reported tradeoffs

Then read [[learning/5. Comparing and Interpreting the Results/_index|5. Comparing and Interpreting the Results]].

Recommended order:

1. [[learning/5. Comparing and Interpreting the Results/5.1 Accuracy per Joule|Accuracy per Joule]]
2. [[learning/5. Comparing and Interpreting the Results/5.2 Convergence Time and Learning Curves|Convergence Time and Learning Curves]]
3. [[learning/5. Comparing and Interpreting the Results/5.3 Comparing SNN Training Strategies|Comparing SNN Training Strategies]]

The comparisons cover ANN, converted SNN, surrogate-gradient SNN, and STDP-based SNN models evaluated on MNIST and CIFAR-10. Treat these as dataset- and setting-specific results. They support careful comparisons among the evaluated models, not universal claims about every ANN or SNN.

A few distinctions are essential:

- High final accuracy does not imply low latency.
- Fewer spikes do not automatically imply the lowest total energy.
- Fast convergence does not necessarily imply the best final accuracy.
- Conversion can preserve useful learned behavior without preserving every efficiency property.
- A model ranking can change when the application gives different weights to accuracy, latency, or energy.

### 6. Turn comparisons into deployment choices

Finish with [[learning/6. Using Application-oriented Model Selection in Practice/_index|6. Using Application-oriented Model Selection in Practice]].

Read:

1. [[learning/6. Using Application-oriented Model Selection in Practice/6.1 Choosing an SNN Training Strategy|Choosing an SNN Training Strategy]]
2. [[learning/6. Using Application-oriented Model Selection in Practice/6.2 Neuromorphic Computing and SNN Deployment|Neuromorphic Computing and SNN Deployment]]
3. [[learning/6. Using Application-oriented Model Selection in Practice/6.3 Scalable Training and Hardware Standardization|Scalable Training and Hardware Standardization]]
4. [[learning/6. Using Application-oriented Model Selection in Practice/6.4 Reasoning from Spikes to Deployment Choices|Reasoning from Spikes to Deployment Choices]]

This final section connects neuron behavior to operational decisions. Surrogate-gradient SNNs are relevant when comparatively high accuracy and low latency are priorities. Conversion is relevant when an existing trained ANN must be transferred into a spiking form. STDP-based SNNs are relevant when unsupervised adaptation, low spike activity, or low-power operation is central.

Neuromorphic systems such as IBM TrueNorth and Intel Loihi provide an important deployment context because their architectures are designed around forms of event-driven neural computation. Broader adoption still faces obstacles, particularly scalable training and limited hardware standardization.

## What You Will Be Able to Do

By the end of the garden, you should be able to:

- Explain how discrete spikes and their timing carry information.
- Trace membrane potential through integration, leakage, threshold crossing, spike emission, and reset.
- Follow encoded input through excitatory and inhibitory populations to a winner-take-all decision.
- Explain why spike generation complicates gradient-based training.
- Distinguish surrogate-gradient training, ANN-to-SNN conversion, and STDP by mechanism and intended use.
- Calculate and interpret classification accuracy, inference latency, spike count, estimated energy, accuracy per joule, and convergence time.
- Read tables and learning curves without confusing final performance, training speed, and operational efficiency.
- Compare the reported MNIST and CIFAR-10 results without turning them into universal rankings.
- Recommend a training strategy based on accuracy, latency, energy, spike count, convergence, transfer, and unsupervised-learning requirements.

## Scope

This garden covers the computational logic of spike-based networks, the Leaky Integrate-and-Fire neuron, input encoding, excitatory and inhibitory competition, three SNN training strategies, six evaluation metrics, reported MNIST and CIFAR-10 comparisons, and application-oriented model selection. It also introduces neuromorphic deployment through TrueNorth and Loihi and examines the challenges of scalable training and hardware standardization.

The garden does not provide framework-specific code, hardware programming instructions, or deployment recipes. It does not derive neuron models beyond the Leaky Integrate-and-Fire mechanism, specify particular surrogate derivative functions, teach detailed ANN-to-SNN calibration procedures, or derive an STDP learning-window equation. It also does not compare additional datasets, architectures, neuromorphic platforms, or biological mechanisms beyond those needed to understand spike-based computation.

Most importantly, the garden does not claim that SNNs universally outperform conventional neural networks. The central lesson is conditional: spike-based computation offers distinctive temporal and event-driven behavior, but its value depends on how a network is trained, how its costs are measured, and what the application requires.