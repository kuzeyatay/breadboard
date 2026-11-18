import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

export async function seedRoom(data) {
  const { ensureBuzzSchema } = await import("../../src/lib/buzz/schema.ts");
  const { createRoom, postMessage } = await import("../../src/lib/buzz/store.ts");
  data.exec(
    "CREATE TABLE organizations(id INTEGER PRIMARY KEY,name TEXT); CREATE TABLE organization_members(id INTEGER PRIMARY KEY,organization_id INTEGER,user_id INTEGER,role TEXT); INSERT INTO organizations VALUES(8,'Fieldwork'); INSERT INTO organization_members VALUES(1,8,1,'admin')",
  );
  ensureBuzzSchema(data);
  const room = createRoom(data, 8, 1, { name: "Fieldwork" });
  const say = (id, body, parentId = null) =>
    postMessage(data, room.id, {
      clientMessageId: id,
      memberId: null,
      authorKind: "human",
      authorName: "Ada",
      body,
      parentId,
    });
  say("old", "Use the yellow checklist for sensor handoffs.");
  const root = say("plan", "Actually, use the violet checklist for sensor handoffs.");
  say("thread", "Use the cobalt form for validation.", root.id);
  return { room, root };
}

export async function personalFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-personal-replay-"));
  process.env.BREADBOARD_DATA_DIR = root;
  const { default: canonical } = await import("../../src/lib/db.ts");
  const data = new Database(":memory:");
  const { ensureCalendarSchema } = await import("../../src/lib/calendar/schema.ts");
  const { ensurePlanSchema } = await import("../../src/lib/plan/schema.ts");
  data.exec(
    "CREATE TABLE users(id INTEGER PRIMARY KEY,email TEXT); CREATE TABLE clusters(id INTEGER PRIMARY KEY,user_id INTEGER,name TEXT,slug TEXT,memory_scope TEXT); CREATE TABLE conversations(id INTEGER PRIMARY KEY,public_id TEXT,user_id INTEGER,title TEXT,updated_at TEXT,default_garden_id INTEGER,temporary INTEGER,surface TEXT); CREATE TABLE conversation_memory_state(conversation_id INTEGER,working_state TEXT); CREATE TABLE hermes_artifacts(id TEXT, user_id INTEGER,conversation_id INTEGER,cluster_id INTEGER,renderer_id TEXT,title TEXT,current_version INTEGER,updated_at TEXT,status TEXT); CREATE TABLE durable_memories(id INTEGER PRIMARY KEY,user_id INTEGER,scope TEXT,scope_id TEXT,state TEXT,kind TEXT,content TEXT,last_confirmed_at TEXT,created_at TEXT)",
  );
  ensureCalendarSchema(data);
  ensurePlanSchema(data);
  data.exec(
    "INSERT INTO users VALUES(1,'one@example.test'),(2,'two@example.test'); INSERT INTO clusters VALUES(10,1,'Headwater','headwater','garden_only'),(11,1,'Meridian','meridian','default'),(12,2,'Hidden','hidden','garden_only')",
  );
  const chat = data.prepare("INSERT INTO conversations VALUES(?,?,?,?,?,?,0,'garden_chat')");
  chat.run(1, "conv_meridian", 1, "Meridian", "2026-11-12T15:00:00Z", 11);
  chat.run(2, "conv_hydro", 1, "Headwater", "2026-11-13T12:00:00Z", 10);
  chat.run(3, "conv_wrong", 2, "Wrong account", "2026-11-17T23:00:00Z", 12);
  data.exec("ALTER TABLE conversations ADD COLUMN buzz_room_id INTEGER");
  data
    .prepare("INSERT INTO conversation_memory_state VALUES(?,?)")
    .run(
      1,
      JSON.stringify({ decisions: ["Use the ceramic housing"], openQuestions: ["Measure drift under load"] }),
    );
  data.exec(
    "INSERT INTO hermes_artifacts VALUES('drift-draft',1,1,11,'markdown','Drift calibration worksheet',4,'2026-11-16T10:00:00Z','ready'),('hydro-draft',1,2,10,'markdown','Catchment worksheet',2,'2026-11-17T10:00:00Z','ready'),('other-draft',2,3,12,'markdown','Other account workbook',2,'2026-11-18T00:00:00Z','ready')",
  );
  data.exec(
    "INSERT INTO plan_projects(id,user_id,name,slug) VALUES(1,1,'Meridian','meridian'); INSERT INTO plan_columns(id,project_id,name,slug,position) VALUES(1,1,'Doing','doing',0); INSERT INTO plan_tasks(id,user_id,project_id,column_id,number,position,title,updated_at) VALUES(17,1,1,1,1,0,'Measure drift under load','2026-11-16T10:30:00Z')",
  );
  const memory = data.prepare(
    "INSERT INTO durable_memories VALUES(?,1,'garden',?,'confirmed','working_pattern',?,NULL,'2026-11-16T10:10:00Z')",
  );
  memory.run(1, "10", "For field notes I draw a catchment map before writing the sampling checklist");
  memory.run(2, "11", "For calibration reviews compare the baseline trace before drafting the error budget");
  const dir = path.join(root, "config");
  fs.mkdirSync(dir, { recursive: true });
  const row = (url, title, owner = 1, days = ["2026-11-14"]) => ({
    url,
    title,
    visitedAt: 1794700800000,
    visitsByUser: { [owner]: { title, visitedAt: 1794700800000, days } },
  });
  const entries = [
    row("https://campus.example.test/courses/42", "Computational Neuroscience · Neurocomp · Canvas"),
    row("https://forge.example.test/teams/atlas", "Atlas design review board", 1, [
      "2026-11-14",
      "2026-11-10",
    ]),
    row("https://old.example.test/courses/42", "Computational Neuroscience archived 2024"),
    row("https://other-account.example.test/teams/atlas", "Atlas design review", 2),
    row("https://decoy.example.test/boards/weather", "Weather dashboard"),
    { url: "https://unassigned.example.test/courses/9", title: "Canvas", visitedAt: 1794700800000 },
  ];
  fs.writeFileSync(path.join(dir, "browser-history.json"), JSON.stringify({ version: 1, entries }));
  const input = {
    userId: 1,
    conversationId: 99,
    surface: "dashboard_terminal",
    query: "",
    personalize: true,
  };
  return {
    root,
    data,
    canonical,
    entries,
    input,
    dir,
    options: { database: data, root },
    close() {
      data.close();
    },
  };
}
