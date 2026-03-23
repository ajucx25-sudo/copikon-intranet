import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile, writeFile, copyFile } from "fs/promises";

const allowlist = [
  "axios", "cors", "date-fns", "drizzle-orm", "drizzle-zod",
  "express", "express-session", "jsonwebtoken", "memorystore",
  "passport", "passport-local", "ws", "zod", "zod-validation-error",
];

async function buildAll() {
  await rm("dist", { recursive: true, force: true });

  console.log("building client...");
  await viteBuild();

  // Copiar logo al dist
  try {
    await copyFile("client/copikon-logo.jpg", "dist/public/copikon-logo.jpg");
    console.log("logo copiado");
  } catch {}

  // Inyectar portal-users.json en el index.html para login offline
  try {
    const htmlPath = "dist/public/index.html";
    let html = await readFile(htmlPath, "utf-8");
    // Buscar portal-users.json en varias ubicaciones
    let usersData = { admin: { username:"admin", password:"copikon2026", cargoId:"ceo", cargo:"CEO", gerencia:"root", nombre:"Administrador", role:"admin" } };
    for (const p of ["../portal-users.json", "../../copikon-organigrama-v2/portal-users.json", "portal-users.json"]) {
      try { usersData = JSON.parse(await readFile(p, "utf-8")); break; } catch {}
    }
    // Inyectar también employees.json como contactos
    let employeesData: any = {};
    for (const p of ["../employees.json", "../../copikon-organigrama-v2/employees.json", "employees.json"]) {
      try { employeesData = JSON.parse(await readFile(p, "utf-8")); break; } catch {}
    }
    const injection = `<script>window.__PORTAL_USERS__ = ${JSON.stringify(usersData)};window.__ORG_EMPLOYEES__ = ${JSON.stringify(employeesData)};</script>`;
    html = html.replace('</head>', injection + '</head>');
    await writeFile(htmlPath, html, "utf-8");
    console.log(`inyectados ${Object.keys(usersData).length} usuarios y ${Object.keys(employeesData).length} empleados en index.html`);
  } catch(e) { console.warn("No se pudo inyectar datos:", e); }

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter((dep) => !allowlist.includes(dep));

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/index.cjs",
    define: { "process.env.NODE_ENV": '"production"' },
    minify: true,
    external: externals,
    logLevel: "info",
  });
}

buildAll().catch((err) => { console.error(err); process.exit(1); });
