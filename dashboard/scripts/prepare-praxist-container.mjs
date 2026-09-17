import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const repo = fileURLToPath(new URL("../..", import.meta.url));
const context = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-praxist-image-"));
try {
  fs.copyFileSync(path.join(repo,"PRAXIST","pyproject.toml"),path.join(context,"pyproject.toml"));
  fs.writeFileSync(path.join(context,"Dockerfile"), `FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends git curl procps ca-certificates && rm -rf /var/lib/apt/lists/*
COPY pyproject.toml /tmp/pyproject.toml
RUN python -c "import tomllib; p=tomllib.load(open('/tmp/pyproject.toml','rb'))['project']; print('\\n'.join(p['dependencies']+p['optional-dependencies']['codex']+p['optional-dependencies']['agents']))" > /tmp/requirements.txt && pip install --no-cache-dir -r /tmp/requirements.txt
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=/opt/praxist
`);
  const result = spawnSync("docker",["build","--tag","breadboard-praxist:local",context],{stdio:"inherit",windowsHide:true});
  process.exitCode = result.status ?? 1;
} finally {
  fs.rmSync(context,{recursive:true,force:true});
}
