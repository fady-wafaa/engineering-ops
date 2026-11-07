// Project stack detection. Reads manifest files only (never runs project code) and returns
// the facts agents need: kind (frontend / backend / netsuite / mobile / library), frameworks,
// package manager, monorepo packages, validation commands and where to start reading code.
// Every value comes from a file that exists; nothing is guessed. Unknown stays null.

import fs from "node:fs";
import path from "node:path";

const FRONTEND = {
  next: "Next.js", react: "React", vue: "Vue", nuxt: "Nuxt", "@angular/core": "Angular", svelte: "Svelte",
  "@sveltejs/kit": "SvelteKit", "solid-js": "Solid", "@remix-run/react": "Remix", astro: "Astro", vite: "Vite",
};
const BACKEND = {
  express: "Express", "@nestjs/core": "NestJS", fastify: "Fastify", koa: "Koa", hono: "Hono", "@hapi/hapi": "hapi",
  prisma: "Prisma", "@prisma/client": "Prisma", mongoose: "Mongoose", typeorm: "TypeORM", sequelize: "Sequelize",
  "drizzle-orm": "Drizzle", "@trpc/server": "tRPC", "apollo-server": "Apollo Server", "@apollo/server": "Apollo Server",
};
const MOBILE = { "react-native": "React Native", expo: "Expo", "@capacitor/core": "Capacitor" };
const NETSUITE = { "@oracle/suitecloud-unit-testing": "SuiteCloud Unit Testing", "@oracle/suitecloud-cli": "SuiteCloud CLI" };
const TEST_TOOLS = {
  vitest: "Vitest", jest: "Jest", "@playwright/test": "Playwright", cypress: "Cypress", mocha: "Mocha",
  "@testing-library/react": "React Testing Library", "@storybook/react": "Storybook",
};

const SCRIPT_KEYS = {
  unit: ["test:unit", "test"],
  integration: ["test:integration", "test:int"],
  e2e: ["test:e2e", "e2e", "playwright", "cypress:run"],
  lint: ["lint"],
  typecheck: ["type-check", "typecheck", "check-types", "tsc", "types"],
  build: ["build"],
  dev: ["dev", "start:dev", "serve", "start"],
};

const ROUTE_DIRS = [
  "app", "src/app", "pages", "src/pages", "src/routes", "src/app/routes", "app/routes", "src/router", "src/views",
  "src/screens", "src/features", "src/modules", "src/controllers", "src/api", "api", "routes", "src/server",
  "server", "src/FileCabinet/SuiteScripts", "FileCabinet/SuiteScripts",
];

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
  } catch {
    return null;
  }
}

function exists(dir, rel) {
  return fs.existsSync(path.join(dir, rel));
}

function readText(dir, rel, max = 200000) {
  try {
    return fs.readFileSync(path.join(dir, rel), "utf8").slice(0, max);
  } catch {
    return "";
  }
}

function packageManager(dir) {
  if (exists(dir, "pnpm-lock.yaml") || exists(dir, "pnpm-workspace.yaml")) return "pnpm";
  if (exists(dir, "bun.lockb") || exists(dir, "bun.lock")) return "bun";
  if (exists(dir, "yarn.lock")) return "yarn";
  if (exists(dir, "package-lock.json")) return "npm";
  if (exists(dir, "package.json")) return "npm";
  return null;
}

function runCmd(pm, script) {
  if (pm === "npm") return script === "test" ? "npm test" : `npm run ${script}`;
  if (pm === "yarn") return `yarn ${script}`;
  if (pm === "bun") return `bun run ${script}`;
  return `pnpm ${script}`;
}

function pick(map, deps) {
  return [...new Set(Object.keys(map).filter((d) => d in deps).map((d) => map[d]))];
}

function workspaceGlobs(dir, pkg) {
  const globs = [];
  if (Array.isArray(pkg?.workspaces)) globs.push(...pkg.workspaces);
  else if (Array.isArray(pkg?.workspaces?.packages)) globs.push(...pkg.workspaces.packages);
  const pnpm = readText(dir, "pnpm-workspace.yaml");
  for (const m of pnpm.matchAll(/^\s*-\s*['"]?([^'"\n#]+)['"]?\s*$/gm)) globs.push(m[1].trim());
  return [...new Set(globs)];
}

// Supports "apps/*", "packages/*", "apps/web" style entries (one level, no deep globs).
function expandWorkspaces(dir, globs) {
  const out = [];
  for (const g of globs) {
    if (g.startsWith("!")) continue;
    const clean = g.replace(/\/\*\*?$/, "/*");
    if (clean.endsWith("/*")) {
      const base = path.join(dir, clean.slice(0, -2));
      if (!fs.existsSync(base)) continue;
      for (const e of fs.readdirSync(base, { withFileTypes: true })) {
        if (e.isDirectory() && fs.existsSync(path.join(base, e.name, "package.json"))) out.push(path.join(clean.slice(0, -2), e.name));
      }
    } else if (fs.existsSync(path.join(dir, clean, "package.json"))) {
      out.push(clean);
    }
  }
  return [...new Set(out)].map((p) => p.split(path.sep).join("/"));
}

function scanNode(dir, rel = ".") {
  const pkg = readJson(path.join(dir, "package.json"));
  if (!pkg) return null;
  const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
  return {
    path: rel,
    name: pkg.name || null,
    frontend: pick(FRONTEND, deps),
    backend: pick(BACKEND, deps),
    mobile: pick(MOBILE, deps),
    netsuite: pick(NETSUITE, deps),
    test_tools: pick(TEST_TOOLS, deps),
    typescript: "typescript" in deps || exists(dir, "tsconfig.json"),
    scripts: pkg.scripts || {},
  };
}

function detectNetSuite(dir) {
  const signals = [];
  if (exists(dir, "suitecloud.config.js")) signals.push("suitecloud.config.js");
  if (exists(dir, "src/manifest.xml")) signals.push("src/manifest.xml");
  if (exists(dir, "src/deploy.xml")) signals.push("src/deploy.xml");
  if (exists(dir, "src/FileCabinet/SuiteScripts")) signals.push("src/FileCabinet/SuiteScripts");
  if (exists(dir, "FileCabinet/SuiteScripts")) signals.push("FileCabinet/SuiteScripts");
  if (exists(dir, "src/Objects")) signals.push("src/Objects");
  const manifest = readText(dir, "src/manifest.xml", 5000);
  const projectType = /projecttype="(\w+)"/i.exec(manifest)?.[1] || null; // ACCOUNTCUSTOMIZATION | SUITEAPP
  return { signals, project_type: projectType };
}

function detectPython(dir) {
  const files = ["pyproject.toml", "requirements.txt", "setup.py", "Pipfile"].filter((f) => exists(dir, f));
  if (!files.length) return null;
  const text = files.map((f) => readText(dir, f, 50000)).join("\n").toLowerCase();
  const fw = [];
  if (/\bdjango\b/.test(text)) fw.push("Django");
  if (/\bfastapi\b/.test(text)) fw.push("FastAPI");
  if (/\bflask\b/.test(text)) fw.push("Flask");
  const tools = [];
  if (/\bpytest\b/.test(text) || exists(dir, "pytest.ini")) tools.push("pytest");
  if (/\bruff\b/.test(text)) tools.push("ruff");
  if (/\bmypy\b/.test(text)) tools.push("mypy");
  const runner = exists(dir, "uv.lock") ? "uv run " : exists(dir, "poetry.lock") ? "poetry run " : "";
  return {
    files,
    frameworks: fw,
    commands: {
      unit: tools.includes("pytest") ? `${runner}pytest` : exists(dir, "manage.py") ? "python manage.py test" : null,
      lint: tools.includes("ruff") ? `${runner}ruff check .` : null,
      typecheck: tools.includes("mypy") ? `${runner}mypy .` : null,
      dev: exists(dir, "manage.py") ? "python manage.py runserver" : null,
    },
    tools,
  };
}

function otherBackends(dir) {
  const found = [];
  if (exists(dir, "go.mod")) found.push({ lang: "Go", commands: { unit: "go test ./...", build: "go build ./...", lint: "go vet ./..." } });
  if (exists(dir, "pom.xml")) found.push({ lang: "Java (Maven)", commands: { unit: "mvn test", build: "mvn package" } });
  if (exists(dir, "build.gradle") || exists(dir, "build.gradle.kts")) {
    const g = exists(dir, "gradlew") ? "./gradlew" : "gradle";
    found.push({ lang: "JVM (Gradle)", commands: { unit: `${g} test`, build: `${g} build` } });
  }
  if (exists(dir, "Cargo.toml")) found.push({ lang: "Rust", commands: { unit: "cargo test", build: "cargo build", lint: "cargo clippy" } });
  if (exists(dir, "composer.json")) found.push({ lang: "PHP", commands: { unit: exists(dir, "artisan") ? "php artisan test" : "vendor/bin/phpunit" } });
  if (exists(dir, "Gemfile")) found.push({ lang: "Ruby", commands: { unit: exists(dir, "bin/rails") ? "bin/rails test" : "bundle exec rspec" } });
  try {
    if (fs.readdirSync(dir).some((f) => f.endsWith(".sln") || f.endsWith(".csproj"))) found.push({ lang: ".NET", commands: { unit: "dotnet test", build: "dotnet build" } });
  } catch {
    // unreadable directory
  }
  return found;
}

const MANIFESTS = ["package.json", "pyproject.toml", "requirements.txt", "go.mod", "pom.xml", "build.gradle", "Cargo.toml", "composer.json", "Gemfile", "suitecloud.config.js"];
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage", "vendor", ".venv", "venv", "__pycache__"]);

export function detectStack(dir, { depth = 1 } = {}) {
  const root = path.resolve(dir);
  const hasRootManifest = MANIFESTS.some((m) => exists(root, m)) || exists(root, "src/manifest.xml");
  // Common layout: no manifest at the root, real apps one folder down (client/, server/, api/).
  if (!hasRootManifest && depth > 0) {
    let subs = [];
    try {
      subs = fs
        .readdirSync(root, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith("."))
        .filter((e) => MANIFESTS.some((m) => exists(path.join(root, e.name), m)))
        .map((e) => ({ dir: e.name, ...detectStack(path.join(root, e.name), { depth: 0 }) }));
    } catch {
      subs = [];
    }
    if (subs.length) {
      const uniq = (k) => [...new Set(subs.flatMap((s) => s[k] || []))];
      return {
        ok: true,
        root,
        kinds: uniq("kinds"),
        frontend: uniq("frontend"),
        backend: uniq("backend"),
        mobile: uniq("mobile"),
        netsuite: subs.find((s) => s.netsuite)?.netsuite || null,
        languages: uniq("languages"),
        package_manager: null,
        monorepo: null,
        test_tools: uniq("test_tools"),
        validation_commands: { unit: null, integration: null, e2e: null, lint: null, typecheck: null, build: null, dev: null },
        command_sources: {},
        subprojects: subs.map((s) => ({
          dir: s.dir,
          kinds: s.kinds,
          frontend: s.frontend,
          backend: s.backend,
          package_manager: s.package_manager,
          validation_commands: s.validation_commands,
          entry_dirs: s.entry_dirs.map((e) => `${s.dir}/${e}`),
        })),
        entry_dirs: subs.flatMap((s) => s.entry_dirs.map((e) => `${s.dir}/${e}`)),
        notes: [`No manifest at the root. Sub-projects: ${subs.map((s) => s.dir).join(", ")}. Run each sub-project's commands inside its folder.`],
      };
    }
  }
  const pm = packageManager(root);
  const rootPkg = readJson(path.join(root, "package.json"));
  const nodeRoot = scanNode(root, ".");
  const wsGlobs = workspaceGlobs(root, rootPkg);
  const wsPaths = expandWorkspaces(root, wsGlobs);
  const packages = wsPaths.map((p) => scanNode(path.join(root, p), p)).filter(Boolean);
  const allNode = [nodeRoot, ...packages].filter(Boolean);

  const frontend = [...new Set(allNode.flatMap((p) => p.frontend))];
  const backend = [...new Set(allNode.flatMap((p) => p.backend))];
  const mobile = [...new Set(allNode.flatMap((p) => p.mobile))];
  const testTools = [...new Set(allNode.flatMap((p) => p.test_tools))];
  const ns = detectNetSuite(root);
  const nsDeps = [...new Set(allNode.flatMap((p) => p.netsuite))];
  const py = detectPython(root);
  const others = otherBackends(root);

  const kinds = [];
  if (frontend.length) kinds.push("frontend");
  if (backend.length || py?.frameworks.length || others.length) kinds.push("backend");
  if (mobile.length) kinds.push("mobile");
  if (ns.signals.length || nsDeps.length) kinds.push("netsuite");
  if (!kinds.length && (nodeRoot || py)) kinds.push("library");

  // Validation commands: root scripts first (monorepo runners), then language defaults.
  const commands = { unit: null, integration: null, e2e: null, lint: null, typecheck: null, build: null, dev: null };
  const sources = {};
  if (nodeRoot && pm) {
    for (const [kind, keys] of Object.entries(SCRIPT_KEYS)) {
      const key = keys.find((k) => k in nodeRoot.scripts);
      if (key) {
        // "test" placeholder from `npm init` is not a real test command.
        if (key === "test" && /no test specified/i.test(nodeRoot.scripts.test)) continue;
        commands[kind] = runCmd(pm, key);
        sources[kind] = `package.json scripts.${key}`;
      }
    }
  }
  for (const extra of [py?.commands, ...others.map((o) => o.commands)]) {
    if (!extra) continue;
    for (const [k, v] of Object.entries(extra)) {
      if (v && !commands[k]) {
        commands[k] = v;
        sources[k] = "language default";
      }
    }
  }
  if (kinds.includes("netsuite")) {
    if (!commands.unit && nsDeps.includes("SuiteCloud Unit Testing")) {
      commands.unit = pm ? runCmd(pm, "test") : "npm test";
      sources.unit = "SuiteCloud Unit Testing (Jest)";
    }
    commands.validate = "suitecloud project:validate";
    sources.validate = "SuiteCloud CLI (needs the CLI and an authenticated account)";
  }

  const entryDirs = new Set();
  for (const base of [".", ...wsPaths]) {
    for (const d of ROUTE_DIRS) if (exists(root, path.join(base, d))) entryDirs.add(path.posix.join(base === "." ? "" : base, d) || d);
  }

  const notes = [];
  if (frontend.includes("Next.js")) notes.push("Next.js: routes come from app/ or pages/ folders.");
  if (kinds.includes("netsuite"))
    notes.push("NetSuite: scripts are SuiteScript (check @NApiVersion and @NScriptType headers); deployments are in src/Objects; never deploy to an account without approval.");
  if (wsPaths.length) notes.push(`Monorepo with ${wsPaths.length} packages; run commands from the root unless a package says otherwise.`);
  if (!commands.unit) notes.push("No unit test command found.");

  return {
    ok: true,
    root,
    kinds,
    frontend,
    backend: [...backend, ...(py?.frameworks || []), ...others.map((o) => o.lang)],
    mobile,
    netsuite: ns.signals.length || nsDeps.length ? { signals: ns.signals, project_type: ns.project_type, tools: nsDeps } : null,
    languages: [
      ...(allNode.some((p) => p.typescript) ? ["TypeScript"] : nodeRoot ? ["JavaScript"] : []),
      ...(py ? ["Python"] : []),
      ...others.map((o) => o.lang),
    ],
    package_manager: pm,
    monorepo: wsPaths.length ? { tool: exists(root, "turbo.json") ? "turbo" : exists(root, "nx.json") ? "nx" : pm, packages: packages.map((p) => ({ path: p.path, name: p.name, frontend: p.frontend, backend: p.backend })) } : null,
    test_tools: [...testTools, ...(py?.tools || [])],
    validation_commands: commands,
    command_sources: sources,
    entry_dirs: [...entryDirs],
    notes,
  };
}
