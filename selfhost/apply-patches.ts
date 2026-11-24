// Applies the template's small source changes to the pinned Piyaz release.
// Fails the build if an anchor is missing, so a version bump can't silently
// drop the invite-only gate.
import { readFileSync, writeFileSync } from "node:fs";

const root = process.argv[2] ?? "/src";
const file = `${root}/lib/auth.ts`;
let text = readFileSync(file, "utf8");

function replaceOnce(anchor: string, replacement: string) {
  const count = text.split(anchor).length - 1;
  if (count !== 1) {
    console.error(`apply-patches: expected 1 match, found ${count}: ${anchor}`);
    process.exit(1);
  }
  text = text.replace(anchor, replacement);
}

replaceOnce(
  'import { betterAuth } from "better-auth";\n',
  'import { betterAuth } from "better-auth";\nimport { assertSelfHostSignupAllowed } from "@/lib/selfhost/signup-gate";\n',
);
replaceOnce(
  "          before: async (user, ctx) => {\n            const body = ctx?.body as { termsAccepted?: unknown } | undefined;\n",
  "          before: async (user, ctx) => {\n            await assertSelfHostSignupAllowed(user.email, ctx?.headers);\n            const body = ctx?.body as { termsAccepted?: unknown } | undefined;\n",
);
writeFileSync(file, text);
console.log("apply-patches: invite-only sign-up gate added to lib/auth.ts");
