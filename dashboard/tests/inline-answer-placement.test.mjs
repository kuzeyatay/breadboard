import assert from 'node:assert/strict';
import test from 'node:test';
import { placeNestedInlineAnswer } from '../src/lib/inline-answer-placement.ts';

const rect = placement => ({left:placement.left,top:placement.top,
  right:placement.left+placement.width,bottom:placement.top+placement.maxHeight});
const separate = (a,b) => a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;

test('long nested answers use free columns outside their parents, including a narrower column',()=>{
  const bounds={left:16,top:16,right:1844,bottom:840};
  const first={left:356,top:180,right:936,bottom:700};
  const second=rect(placeNestedInlineAnswer({anchor:{left:400,top:450,right:780,bottom:495},bounds,occupied:[first],desiredHeight:520}));
  assert.ok(separate(first,second));
  const third=rect(placeNestedInlineAnswer({anchor:{left:second.left+30,top:second.top+180,right:second.right-30,bottom:second.top+220},
    bounds,occupied:[first,second],desiredHeight:520}));
  assert.ok(separate(first,third)&&separate(second,third));
  for(const card of [second,third]) {
    assert.ok(card.left>=bounds.left&&card.right<=bounds.right&&card.top>=bounds.top&&card.bottom<=bounds.bottom);
    assert.ok(card.right-card.left>=340);
  }
});

test('crowded phone layouts stay within the viewport and above the composer',()=>{
  const bounds={left:16,top:16,right:374,bottom:600};
  const occupied=[{left:16,top:60,right:374,bottom:530}];
  const next=rect(placeNestedInlineAnswer({anchor:{left:40,top:390,right:320,bottom:420},bounds,occupied,desiredHeight:520}));
  assert.ok(next.top>occupied[0].top,'the prior card keeps an exposed top edge');
  assert.ok(next.left>=16&&next.right<=374&&next.bottom<=600);
});

test('visualizer answers use a wider column and fall back to a readable bounded stack', () => {
  for (const viewportWidth of [1900, 1073, 390]) {
    const bounds = {left:16, top:68, right:viewportWidth-16, bottom:840};
    const parent = {left:16, top:100, right:Math.min(596, bounds.right), bottom:620};
    const placement = placeNestedInlineAnswer({anchor:parent, bounds, occupied:[parent],
      desiredHeight:1000, desiredWidth:960, maxHeight:772, minimumWidth:640});
    const card = rect(placement);
    assert.ok(placement.width >= Math.min(640, bounds.right-bounds.left));
    assert.ok(card.left >= bounds.left && card.right <= bounds.right);
    assert.ok(card.top >= bounds.top && card.bottom <= bounds.bottom);
    if (viewportWidth === 1900) {
      assert.equal(placement.width, 960);
      assert.ok(placement.maxHeight > 520);
      assert.ok(separate(parent, card));
    }
  }
});
