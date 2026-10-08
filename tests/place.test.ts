import { describe, expect, it } from "vitest";
import type { Finding, Review } from "../src/original/schema.ts";
import { placeFindings } from "../src/review/place.ts";

const diff = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
 line1
 line2
 line3
+added
`;

function finding(over: Partial<Finding> = {}): Finding {
  return {
    severity: "minor",
    path: "src/a.ts",
    line: 4,
    side: "RIGHT",
    text: "looks off",
    ...over,
  };
}

function review(findings: Finding[]): Review {
  return { summary: "done", findings };
}

describe("placeFindings", () => {
  it("keeps on-diff findings and drops off-diff ones", () => {
    const placed = placeFindings({
      diff,
      review: review([finding(), finding({ line: 99 })]),
      requestChangesWorkflow: false,
    });
    expect(placed.kept).toEqual([finding()]);
    expect(placed.comments).toHaveLength(1);
    expect(placed.comments[0]?.body).toBe("_minor_\n\nlooks off");
    expect(placed.summary).toContain("Actionable comments posted: 1");
  });

  it("uses COMMENT when request-changes is off even for blockers", () => {
    const placed = placeFindings({
      diff,
      review: review([finding({ severity: "blocking" })]),
      requestChangesWorkflow: false,
    });
    expect(placed.event).toBe("COMMENT");
  });

  it("requests changes only for kept blockers when the workflow is on", () => {
    expect(
      placeFindings({
        diff,
        review: review([finding({ severity: "blocking" })]),
        requestChangesWorkflow: true,
      }).event,
    ).toBe("REQUEST_CHANGES");
    expect(
      placeFindings({
        diff,
        review: review([finding()]),
        requestChangesWorkflow: true,
      }).event,
    ).toBe("APPROVE");
  });

  it("fences suggested fixes as diff blocks", () => {
    const placed = placeFindings({
      diff,
      review: review([finding({ suggested_fix: "-old\n+new" })]),
      requestChangesWorkflow: false,
    });
    expect(placed.comments[0]?.body).toContain("```diff\n-old\n+new\n```");
    expect(placed.comments[0]?.body).not.toContain("```suggestion");
  });

  it("does not wrap prose suggested_fix in a fake diff fence", () => {
    const placed = placeFindings({
      diff,
      review: review([finding({ suggested_fix: "Extract the shared row helper." })]),
      requestChangesWorkflow: false,
    });
    expect(placed.comments[0]?.body).toContain("**Suggested fix:** Extract the shared row helper.");
    expect(placed.comments[0]?.body).not.toContain("```diff");
  });
});
