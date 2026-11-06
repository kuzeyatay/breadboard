import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runElectronFixture } from "./helpers/run-electron-fixture";

test("web highlights use the shared selector, survive refresh/reopen, and attach questions to Terminal", async () => {
  const desktop = path.resolve(__dirname, "../..");
  const dashboard = path.join(desktop, "../dashboard");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-web-highlights-"));
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  try {
    const esbuild = require(require.resolve("esbuild", { paths: [dashboard] }));
    await esbuild.build({ bundle: true, platform: "browser", format: "iife", jsx: "automatic",
      alias: { "@": path.join(dashboard, "src") }, logLevel: "silent", outfile: path.join(dir, "menu.js"),
      stdin: { resolveDir: dashboard, loader: "tsx", contents: `
        import React from 'react'; import { createRoot } from 'react-dom/client';
        import Menu from '@/app/browser/selection-popover/selection-popover';
        createRoot(document.getElementById('root')).render(<Menu entry={JSON.parse(new URLSearchParams(location.search).get('entry') ?? 'null')}/>);
      ` },
    });
    await esbuild.build({ bundle: true, platform: "browser", format: "iife", jsx: "automatic",
      alias: { "@": path.join(dashboard, "src") }, logLevel: "silent", outfile: path.join(dir, "answer.js"),
      stdin: { resolveDir: dashboard, loader: "tsx", contents: `
        import React from 'react'; import { createRoot } from 'react-dom/client';
        import Answer from '@/app/browser/inline-answer/inline-answer';
        createRoot(document.getElementById('root')).render(<Answer/>);
      ` },
    });
    await esbuild.build({ bundle: true, platform: "browser", format: "iife", jsx: "automatic",
      alias: { "@": path.join(dashboard, "src") }, logLevel: "silent", outfile: path.join(dir, "owner.js"),
      stdin: { resolveDir: dashboard, loader: "tsx", contents: `
        import React,{useEffect,useState} from 'react'; import {createRoot} from 'react-dom/client';
        import {useBrowserInlineAnswer} from '@/app/components/hermes/use-browser-inline-answer';
        import {sendDesktopTabsCommand} from '@/lib/desktop-browser-tabs';
        function Owner() {
          const [selection,setSelection]=useState(null); const [content,setContent]=useState(null);
          window.setOwnerAnswer=answer=>setContent(current=>({...current,answer}));
          useEffect(()=>{
            const receive=state=>{ const s=state.tabs.find(t=>t.id===state.activeId)?.browser?.selection;
              setSelection(s?.reference?.mode==='inline'?s:null); };
            window.breadboardDesktop.getTabsState().then(receive);
            return window.breadboardDesktop.onTabsState(receive);
          },[]);
          useEffect(()=>{ if(selection) setContent(JSON.parse(localStorage.getItem('answer:'+selection.reference.id)??'null')??{pending:false,canAsk:true}); },[selection?.requestId]);
          useBrowserInlineAnswer({selection,content,
            onAsk:(question,attachments)=>{
              window.ownerQuestion={question,selection:selection.reference};
              setContent({question,questionAttachments:attachments,pending:true,canAsk:false});
              window.finishOwnerAnswer=()=>{
                const saved={question,questionAttachments:attachments,answer:'A saved explanation.',pending:false,canAsk:true,conversationId:'conv_saved'};
                localStorage.setItem('answer:'+selection.reference.id,JSON.stringify(saved)); setContent(saved);
                sendDesktopTabsCommand({type:'browser-selection-conversation',id:selection.reference.id,url:selection.url,conversationId:'conv_saved'});
              };
            },onStop:()=>setContent(previous=>({...previous,pending:false,canAsk:true})),
            onDelete:()=>sendDesktopTabsCommand({type:'browser-selection-delete',id:selection.reference.id,url:selection.url}),
            onClose:()=>{window.ownerClosed=true;}});
          return <div>Terminal owns the saved conversation</div>;
        }
        createRoot(document.getElementById('root')).render(<Owner/>);
      ` },
    });
    await esbuild.stop();
    const postcss = require(require.resolve("postcss", { paths: [dashboard] }));
    const tailwind = require(require.resolve("@tailwindcss/postcss", { paths: [dashboard] }));
    const stylesheet = path.join(dashboard, "src/app/globals.css");
    const css = await postcss([tailwind({ base: dashboard })]).process(fs.readFileSync(stylesheet, "utf8"), { from: stylesheet });
    fs.writeFileSync(path.join(dir, "menu.css"), css.css);
    const result = await runElectronFixture(require("electron") as string,
      [path.join(desktop, "tests/fixtures/browser-text-highlights.cjs"), dir], desktop, env, 90_000);
    assert.equal(result.error, undefined, `${result.error?.message}\n${result.output}`);
    assert.equal(result.status, 0, result.output);
  } finally {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
