import assert from "node:assert/strict";
import test from "node:test";
import {finalResearchAnswer, isResearchAssistant} from "../src/lib/openscience/messages.ts";

test("internal compaction and tool commentary cannot become the completed research finding", () => {
  const messages = [
    {info:{role:"user"},parts:[{type:"text",text:"Research this"}]},
    {info:{role:"assistant",finish:"tool-calls"},parts:[{type:"text",text:"I will check"},{type:"tool"}]},
    {info:{role:"assistant",summary:true,finish:"stop"},parts:[{type:"text",text:"Internal handoff: checks have not run yet"}]},
    {info:{role:"assistant",finish:"stop"},parts:[{type:"text",text:"Checks ran successfully."},{type:"text",text:"Measured result: 12 units."}]},
  ];
  assert.equal(finalResearchAnswer(messages),"Checks ran successfully.\n\nMeasured result: 12 units.");
  assert.equal(isResearchAssistant(messages[2].info),false);
  assert.equal(isResearchAssistant({role:"assistant",mode:"compaction"}),false);
  assert.equal(isResearchAssistant({role:"assistant",agent:"compaction"}),false);
  assert.equal(finalResearchAnswer(messages.slice(0,-1)),"");
});

test("an errored or truncated final answer does not pass as completed prose", () => {
  for (const info of [{error:{message:"upstream failed"}},{finish:"length"}]) {
    assert.equal(finalResearchAnswer([{info:{role:"assistant",...info},parts:[{type:"text",text:"Partial finding"}]}]),"");
  }
  assert.equal(finalResearchAnswer([{info:{role:"assistant"},parts:[{type:"text",text:"Legacy complete answer"}]}]),"Legacy complete answer");
});
