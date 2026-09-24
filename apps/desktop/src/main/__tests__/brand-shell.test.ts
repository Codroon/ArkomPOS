/**
 * The name on the outside of the app — v1.1.0's rebrand, pinned.
 *
 * The product name is a literal in four places that cannot import each other:
 * an HTML document, a TypeScript main process, a YAML build config and a
 * package manifest. Nothing makes them agree, which is why the first build
 * after the rebrand still said "Arkom POS" in its title bar — the renderer's
 * `<title>` overrides whatever title the BrowserWindow was given, and one file
 * had been missed.
 *
 * A shop sees that name in the title bar, in Alt-Tab, on the Start-menu entry
 * and in *Add or remove programs*. This file is the thing that makes a miss
 * fail a test run instead of a customer's first launch.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DESKTOP = join(__dirname, "../../..");
const REPO = join(DESKTOP, "../..");

const PRODUCT = "Codroon POS";
/** Names this product has been sold or shipped under before. */
const FORMER = ["Arkom POS", "ARKOM POS", "Arkom Pos"];

const read = (...parts: string[]) => readFileSync(join(...parts), "utf8");

describe("the name a shop sees", () => {
  it("is the document title, which is what the title bar actually shows", () => {
    const html = read(DESKTOP, "src/renderer/index.html");
    const title = /<title>([^<]*)<\/title>/.exec(html)?.[1]?.trim();
    expect(title).toBe(PRODUCT);
  });

  it("is what the main process names the app and the window", () => {
    const main = read(DESKTOP, "src/main/index.ts");
    expect(main).toContain(`app.setName(app.isPackaged ? "${PRODUCT}" : "${PRODUCT} (dev)")`);
    expect(main).toContain(`title: "${PRODUCT}"`);
  });

  it("is what the installer, the shortcut and Add-or-remove-programs use", () => {
    const yml = read(DESKTOP, "electron-builder.yml");
    expect(yml).toContain(`productName: ${PRODUCT}`);
    expect(yml).toContain(`shortcutName: ${PRODUCT}`);
  });

  it("appears nowhere as the name it used to be", () => {
    const shells = [
      read(DESKTOP, "src/renderer/index.html"),
      read(DESKTOP, "src/main/index.ts"),
      read(DESKTOP, "electron-builder.yml"),
      read(REPO, "packages/ui/src/i18n/es.ts"),
      read(REPO, "packages/ui/src/i18n/en.ts"),
    ].join("\n");

    for (const name of FORMER) expect(shells).not.toContain(name);
  });
});

describe("the application id", () => {
  it("is the OLD one, deliberately, so an installed till upgrades in place", () => {
    /* Windows identifies an install by appId. Changing it with the rebrand would
       have left every Arkom POS install sitting beside a second program with the
       same shortcuts and a different data folder — two tills, one counter. The
       id is plumbing; the NAME is what a shop reads (DEPLOYMENT §5b). */
    const yml = read(DESKTOP, "electron-builder.yml");
    expect(yml).toContain("appId: com.codroon.arkompos");
  });

  it("is matched by the userData folder the first launch adopts", () => {
    /* Electron keeps a till's database under a folder named after the app, so
       renaming the app moves the shop's data. `user-data-move.ts` moves it once,
       and this pins that the folder it looks for is the name we used to use. */
    const move = read(DESKTOP, "src/main/user-data-move.ts");
    expect(move).toContain('FORMER_NAMES = ["Arkom POS"]');
  });
});
