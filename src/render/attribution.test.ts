import { describe, expect, it } from "vitest";
import { attributionHtml } from "./attribution.js";

describe("attributionHtml", () => {
  it("lists each dataset with its licenses", () => {
    const html = attributionHtml([
      {
        qualified_name: "queria/e_stat",
        title: "e-Stat",
        page_url: "https://queria.io/datasets/queria/e_stat",
        licenses: [{ id: "CC-BY-4.0", title: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/" }],
        catalog_url: "u",
      },
    ]);
    expect(html).toContain('href="https://queria.io/datasets/queria/e_stat"');
    expect(html).toContain(">CC BY 4.0</a>");
  });
  it("does not link non-http URLs", () => {
    expect(attributionHtml([{ qualified_name: "a/b", page_url: "javascript:x", catalog_url: "u" }])).not.toContain("javascript:");
  });
  it("shows only the logo without datasets", () => {
    expect(attributionHtml([])).not.toContain("Source");
    expect(attributionHtml([])).toContain('aria-label="Queria"');
  });
});
