import assert from 'node:assert/strict';
import test from 'node:test';
import {listFirstPartySkills} from '../src/lib/hermes/skills.ts';
import {resolveCommandMessage} from '../src/lib/hermes/commands.ts';
import {diagramCommandText, DIAGRAM_IN_CHAT_SKILL} from '../src/lib/hermes/diagram-intent.ts';
import {asciiDiagramCommandText} from '../src/lib/hermes/ascii-diagram-intent.ts';
import {
  selectedInteractiveVisualizerSkill, isInteractiveVisualizerSkill,
  shouldRenderInteractiveVisualizerInline, interactiveVisualizerCommandForArtifact,
} from '../src/lib/hermes/interactive-visualizer-skills.ts';

test('ordinary diagrams resolve to an installed inline skill on both chat backends', async () => {
  for (const surface of ['dashboard_terminal', 'garden_chat']) {
    const skill = listFirstPartySkills(surface).find(s => s.slug === DIAGRAM_IN_CHAT_SKILL);
    assert.ok(skill?.healthy && skill.enabled);
    assert.equal(skill.availability, 'ready');
    assert.equal(skill.classification, 'eligible_general');
    assert.ok(skill.capabilityContract.requiredTools.includes('interactive_visualizer_create'));
    for (const text of ['draw a diagram of the compressor', 'draw a box-and-arrow layout of the compressor', 'draw a zoomable flowchart of the compressor']) {
      const input = {text, surface, authenticated:true};
      assert.equal(asciiDiagramCommandText(input).automatic, false);
      const selected = diagramCommandText(input);
      assert.equal(selected.text, `/diagram-in-chat ${text}`);
      const resolved = await resolveCommandMessage(1, selected.text, undefined, {mode:'knowledge',surface});
      assert.deepEqual(resolved.invocations.map(i=>i.slug), [DIAGRAM_IN_CHAT_SKILL]);
      assert.equal(resolved.userText, text);
      assert.ok(resolved.text.includes('The `package` contains:'), 'full package instructions survive command injection');
    }
  }
});

test('diagram artifacts keep their authorization, inline presentation and revision command', () => {
  assert.equal(isInteractiveVisualizerSkill(DIAGRAM_IN_CHAT_SKILL), true);
  assert.equal(selectedInteractiveVisualizerSkill(new Set([DIAGRAM_IN_CHAT_SKILL])), DIAGRAM_IN_CHAT_SKILL);
  const artifact = {renderer:'interactive-visualizer',sourceSkill:DIAGRAM_IN_CHAT_SKILL};
  assert.equal(shouldRenderInteractiveVisualizerInline(artifact), true);
  assert.equal(interactiveVisualizerCommandForArtifact(artifact), '/diagram-in-chat ');
  assert.equal(shouldRenderInteractiveVisualizerInline({...artifact,renderer:'html'}), false);
  assert.equal(shouldRenderInteractiveVisualizerInline({...artifact,sourceSkill:'diagram-design'}), false);
});

test('explicit formats and explicit legacy skills remain the user’s choice', () => {
  const input = {surface:'garden_chat',authenticated:true};
  for (const text of ['/diagram-design draw the compressor', '/ascii-art-diagrams draw it', 'write the Mermaid source for this flow']) {
    assert.equal(diagramCommandText({...input,text}).automatic, false);
  }
  assert.equal(asciiDiagramCommandText({...input,text:'draw the compressor diagram as ASCII'}).automatic, true);
});
