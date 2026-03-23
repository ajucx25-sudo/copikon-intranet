import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile, copyFile } from "fs/promises";

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
