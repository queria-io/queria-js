import { describe, expect, it } from "vitest";
import { chartSvg, imageName } from "./export.js";

const spec = { mark: "bar", encoding: { x: { field: "name", type: "nominal" }, y: { field: "v", type: "quantitative" } } };
const rows = [{ name: "a", v: 1 }, { name: "b", v: 2 }];
const size = (svg: string) => /<svg[^>]*width="(\d+)"[^>]*height="(\d+)"/.exec(svg)?.slice(1).map(Number);

describe("chartSvg", () => {
  it("draws the chart at the size asked for, on a solid background", async () => {
    const svg = await chartSvg(spec, rows, { width: 600, height: 300 });
    expect(size(svg)).toEqual([600, 300]);
    expect(svg).toContain('fill="#ffffff"');
    expect(svg).toContain("#a1a1aa");
  });

  it("keeps the spec's own config over the theme", async () => {
    const svg = await chartSvg({ ...spec, encoding: { ...spec.encoding, color: { field: "name" } }, config: { legend: { disable: true } } }, rows);
    expect(svg).not.toContain('class="mark-group role-legend"');
  });

  it("leaves panels split by a row encoding at their own size", async () => {
    const svg = await chartSvg({ ...spec, encoding: { ...spec.encoding, row: { field: "name" } } }, rows, { width: 600, height: 300 });
    // Asked-for width on each panel would make the image wider than asked (746 px here)
    expect(size(svg)?.[0]).toBeLessThan(600);
  });

  it("draws annotations", async () => {
    expect(await chartSvg(spec, rows, { annotations: [{ at: "b", text: "最大" }] })).toContain("最大");
  });

  it("colors the highlighted value purple", async () => {
    expect(await chartSvg(spec, rows, { highlight: "b", theme: "dark" })).toContain("#a985e6");
  });

  it("names the sources under the chart with the logo", async () => {
    const svg = await chartSvg(spec, rows, {
      width: 600,
      height: 300,
      sources: [{ qualified_name: "queria/e_stat", title: "e-Stat <統計>", catalog_url: "", licenses: [{ id: "CC-BY-4.0", title: "CC BY 4.0" }] }],
    });
    expect(size(svg)).toEqual([600, 300]);
    expect(svg).toContain("Source: e-Stat &lt;統計&gt; (CC BY 4.0)");
    expect(svg).toContain('stroke="#7846BE"');
    expect(svg.match(/<svg/g)).toHaveLength(3);
  });
});

describe("number labels", () => {
  it("write years without separators", async () => {
    const svg = await chartSvg({ mark: "line", encoding: { x: { field: "year", type: "quantitative" }, y: { field: "v", type: "quantitative" } } }, [
      { year: 1980, v: 20000 },
      { year: 2020, v: 30000 },
    ]);
    expect(svg).toContain(">2000<");
    expect(svg).not.toContain("2,000");
    expect(svg).toContain("万<");
  });
});

describe("imageName", () => {
  it("names the file after the chart's title", () => {
    expect(imageName({ ...spec, title: "人口 / 世帯" })).toBe("人口_世帯.png");
    expect(imageName({ ...spec, title: { text: "人口" } })).toBe("人口.png");
    expect(imageName(spec)).toBe("chart.png");
  });
});
