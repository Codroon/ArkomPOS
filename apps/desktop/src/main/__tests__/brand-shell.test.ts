/**
 * The name on the outside of the app — whichever brand is on.
 *
 * The product name is a literal in five places that cannot import each other:
 * an HTML document, a TypeScript main process, a YAML build config, two i18n
 * dictionaries. Nothing makes them agree, which is why the first build after
 * the Codroon rename still said "Arkom POS" in its title bar.
 *
 * So this reads `packages/ui/src/brand/active.json` — what `pnpm brand` last
 * applied — and asserts every surface says the same thing. It does not care
 * WHICH brand is on, which is the point: the pilot ships as Arkom POS, the
 * product ships as Codroon POS, and the same test guards both.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DESKTOP = join(__dirname, "../../..");
const REPO = join(DESKTOP, "../..");

const read = (...parts: string[]) => readFileSync(join(...parts), "utf8");

const active = JSON.parse(read(REPO, "packages/ui/src/brand/active.json")) as {
  key: string;
  productName: string;
  wordmark: string;
  wordmarkSuffix: string;
  copyright: string;
};

/** Every brand this product can wear; only one may appear on a given build. */
const ALL_NAMES = ["Codroon POS", "Arkom POS"];
const OTHERS = ALL_NAMES.filter((name) => name !== active.productName);

describe(`the name a shop sees (${active.productName})`, () => {
  it("is the document title, which is what the title bar actually shows", () => {
    const html = read(DESKTOP, "src/renderer/index.html");
    const title = /<title>([^<]*)<\/title>/.exec(html)?.[1]?.trim();
    expect(title).toBe(active.productName);
  });

  it("is what the main process names the app and the window", () => {
    const main = read(DESKTOP, "src/main/index.ts");
    expect(main).toContain(
      `app.setName(app.isPackaged ? "${active.productName}" : "${active.productName} (dev)")`,
    );
    expect(main).toContain(`title: "${active.productName}"`);
  });

  it("is what the installer, the shortcut and Add-or-remove-programs use", () => {
    const yml = read(DESKTOP, "electron-builder.yml");
    expect(yml).toContain(`productName: ${active.productName}`);
    expect(yml).toContain(`shortcutName: ${active.productName}`);
  });

  it("is the wordmark on the brand plate, in both languages", () => {
    for (const lang of ["es", "en"]) {
      const dict = read(REPO, `packages/ui/src/i18n/${lang}.ts`);
      expect(dict).toContain(`"shell.brand": "${active.wordmark}"`);
      expect(dict).toContain(`"shell.brandSuffix": "${active.wordmarkSuffix}"`);
    }
  });

  it("appears nowhere as a brand this build is not", () => {
    /* one build, one brand: a screen still carrying the other one is how a
       pilot customer ends up looking at somebody else's name */
    const shells = [
      read(DESKTOP, "src/renderer/index.html"),
      read(DESKTOP, "src/main/index.ts"),
      read(DESKTOP, "electron-builder.yml"),
      read(REPO, "packages/ui/src/i18n/es.ts"),
      read(REPO, "packages/ui/src/i18n/en.ts"),
    ].join("\n");

    for (const other of OTHERS) expect(shells).not.toContain(other);
  });
});

describe("the application id", () => {
  it("is the OLD one, deliberately, so an installed till upgrades in place", () => {
    /* Windows identifies an install by appId, and it has been this value since
       before the first installer was ever packaged. Changing it with a rebrand
       would leave a shop with a second program beside the first, sharing its
       shortcuts and owning a different data folder. The id is plumbing; the
       NAME is what a shop reads (DEPLOYMENT §5b). */
    const yml = read(DESKTOP, "electron-builder.yml");
    expect(yml).toContain("appId: com.codroon.arkompos");
  });

  it("does not move a shop's data folder onto itself", () => {
    /* The pilot is called what the product used to be called, so the "adopt the
       old folder" path would otherwise point at the folder it is already using. */
    const move = read(DESKTOP, "src/main/user-data-move.ts");
    expect(move).toContain('FORMER_NAMES = ["Arkom POS"]');
    expect(move).toContain("if (previous === current) continue;");
  });
});

describe("the copyright", () => {
  it("stays with whoever wrote the software, whatever name is on the door", () => {
    /* The one line Odoo does not let anybody remove either. It is Codroon's on
       an Arkom-branded build, because Codroon wrote it and supports it. */
    expect(active.copyright).toContain("Codroon");
  });
});
