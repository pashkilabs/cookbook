import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../../../apps/web/.env.local", import.meta.url), "utf8").split("\n")) {
  const at = line.indexOf("=");
  if (at > 0 && !line.startsWith("#")) process.env[line.slice(at * 0, at).trim()] ??= line.slice(at + 1).trim();
}
const { cascadeFromEnv } = await import("../src/openai-compatible.js");
const { inferComponents } = await import("../src/components.js");
const cascade = cascadeFromEnv()!;
console.log("model:", cascade.models[0]);
for (let i = 0; i < 3; i += 1) {
  const started = Date.now();
  try {
    const reasons: string[] = [];
    const out = await inferComponents({
      provider: cascade.provider, model: cascade.models[0]!,
      recipe: { title: "Chicken Parmesan", ingredients: ["2 chicken breasts", "1 cup breadcrumbs", "2 cups marinara", "8 oz mozzarella", "1 lb spaghetti"] },
      onReject: (r) => reasons.push(r),
    });
    console.log(`  ${i}: ${Date.now() - started}ms ->`, out ? `${out.length} components` : `null (${reasons.join(",") || "no reason recorded"})`);
  } catch (e) {
    console.log(`  ${i}: ${Date.now() - started}ms -> THREW: ${(e as Error).message.slice(0, 140)}`);
  }
}
