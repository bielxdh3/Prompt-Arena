import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AdvancedArenaView } from "./advanced-arena-view";

describe("Advanced Arena surface", () => {
  it("renders an honest keyboard-labelled browser preview boundary", () => {
    const markup = renderToStaticMarkup(<AdvancedArenaView />);

    expect(markup).toContain("Advanced Arena");
    expect(markup).toContain("Browser preview / no writes");
    expect(markup).toContain("cannot read desktop summaries");
    expect(markup).toContain("no network call");
  });
});
