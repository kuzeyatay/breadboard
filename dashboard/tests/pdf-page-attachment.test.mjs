import assert from 'node:assert/strict';
import test from 'node:test';
import { chatMessageAttachments, normalizeChatMessageAttachments, visibleChatMessageAttachments } from '../src/lib/chat-attachments.ts';
import { parseChatAttachments } from '../src/lib/chat-attachments-request.ts';
import { pdfViewContext } from '../src/lib/pdf-assistant.ts';

test('send-time PDF page metadata survives request validation and saved transcript normalization', () => {
  const context = pdfViewContext({title:'Filters',pageCount:40,pageNumber:23,pages:[23],text:'Circuit text'});
  const parsed = parseChatAttachments([context]);
  const saved = normalizeChatMessageAttachments(JSON.parse(JSON.stringify(chatMessageAttachments(parsed))));
  assert.deepEqual(saved[0].pdfPage,{title:'Filters',pageNumber:23});
  assert.deepEqual(visibleChatMessageAttachments(saved).attachments,[],'raw evidence files remain hidden behind the page chip');
  for (const pageNumber of [0,-1,1.5,'23',Infinity]) {
    const invalid = {...context,pdfPage:{title:'Filters',pageNumber}};
    assert.equal(parseChatAttachments([invalid])[0].pdfPage,undefined);
    assert.equal(normalizeChatMessageAttachments([{...invalid,type:'file'}])[0].pdfPage,undefined);
  }
});
